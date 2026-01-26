//! Redis queue client for job processing
//!
//! Uses Redis Streams for reliable message delivery with consumer groups.

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, RedisError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, instrument};

/// Queue message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMessage<T> {
    pub id: String,
    pub payload: T,
    pub created_at: i64,
    pub attempts: u32,
}

impl<T> QueueMessage<T> {
    pub fn new(id: impl Into<String>, payload: T) -> Self {
        Self {
            id: id.into(),
            payload,
            created_at: chrono::Utc::now().timestamp_millis(),
            attempts: 0,
        }
    }
}

/// Step job payload for worker queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepJob {
    pub run_id: String,
    pub step_id: String,
    pub step_type: String,
    pub input: serde_json::Value,
    pub context: JobContext,
}

/// Job context with tenant/project info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobContext {
    pub tenant_id: String,
    pub project_id: String,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

/// Redis queue client
///
/// This client is designed to be shared across multiple tasks without locks.
/// The underlying `MultiplexedConnection` is Clone and handles concurrency internally.
#[derive(Clone)]
pub struct QueueClient {
    conn: MultiplexedConnection,
    prefix: String,
}

impl QueueClient {
    /// Create a new queue client
    pub async fn new(redis_url: &str, prefix: &str) -> Result<Self, RedisError> {
        let client = redis::Client::open(redis_url)?;
        let conn = client.get_multiplexed_async_connection().await?;
        Ok(Self {
            conn,
            prefix: prefix.to_string(),
        })
    }

    /// Get a clone of the connection for concurrent operations
    fn conn(&self) -> MultiplexedConnection {
        self.conn.clone()
    }

    /// Get the full stream key with prefix
    fn stream_key(&self, queue: &str) -> String {
        format!("{}stream:{}", self.prefix, queue)
    }

    /// Get the consumer group name
    fn group_name(&self, queue: &str) -> String {
        format!("{}-workers", queue)
    }

    /// Initialize a queue (create stream and consumer group)
    #[instrument(skip(self))]
    pub async fn init_queue(&self, queue: &str) -> Result<(), RedisError> {
        let key = self.stream_key(queue);
        let group = self.group_name(queue);
        let mut conn = self.conn();

        // Create consumer group (creates stream if needed)
        // MKSTREAM creates the stream if it doesn't exist
        let result: Result<(), RedisError> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(&key)
            .arg(&group)
            .arg("$")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;

        // Ignore "BUSYGROUP Consumer Group name already exists" error
        match result {
            Ok(()) => Ok(()),
            Err(e) if e.to_string().contains("BUSYGROUP") => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Enqueue a message
    #[instrument(skip(self, message))]
    pub async fn enqueue<T: Serialize>(
        &self,
        queue: &str,
        message: &QueueMessage<T>,
    ) -> Result<String, RedisError> {
        let key = self.stream_key(queue);
        let mut conn = self.conn();
        let payload = serde_json::to_string(message).map_err(|e| {
            RedisError::from((
                redis::ErrorKind::TypeError,
                "JSON serialization error",
                e.to_string(),
            ))
        })?;

        let id: String = redis::cmd("XADD")
            .arg(&key)
            .arg("*") // Auto-generate ID
            .arg("data")
            .arg(payload)
            .query_async(&mut conn)
            .await?;

        debug!(queue = %queue, stream_id = %id, "Enqueued message");
        Ok(id)
    }

    /// Dequeue messages (read from consumer group)
    #[instrument(skip(self))]
    pub async fn dequeue<T: for<'de> Deserialize<'de>>(
        &self,
        queue: &str,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<(String, QueueMessage<T>)>, RedisError> {
        let key = self.stream_key(queue);
        let group = self.group_name(queue);
        let mut conn = self.conn();

        // XREADGROUP GROUP group consumer [COUNT count] [BLOCK ms] STREAMS key >
        let result: redis::Value = redis::cmd("XREADGROUP")
            .arg("GROUP")
            .arg(&group)
            .arg(consumer)
            .arg("COUNT")
            .arg(count)
            .arg("BLOCK")
            .arg(block_ms)
            .arg("STREAMS")
            .arg(&key)
            .arg(">") // Only new messages
            .query_async(&mut conn)
            .await?;

        self.parse_stream_response(result)
    }

    /// Acknowledge a message (remove from pending)
    #[instrument(skip(self))]
    pub async fn ack(&self, queue: &str, stream_id: &str) -> Result<(), RedisError> {
        let key = self.stream_key(queue);
        let group = self.group_name(queue);
        let mut conn = self.conn();

        let _: i32 = redis::cmd("XACK")
            .arg(&key)
            .arg(&group)
            .arg(stream_id)
            .query_async(&mut conn)
            .await?;

        debug!(queue = %queue, stream_id = %stream_id, "Acknowledged message");
        Ok(())
    }

    /// Claim pending messages that haven't been acknowledged
    #[instrument(skip(self))]
    pub async fn claim_pending<T: for<'de> Deserialize<'de>>(
        &self,
        queue: &str,
        consumer: &str,
        min_idle_ms: u64,
        count: usize,
    ) -> Result<Vec<(String, QueueMessage<T>)>, RedisError> {
        let key = self.stream_key(queue);
        let group = self.group_name(queue);
        let mut conn = self.conn();

        // First, get pending messages info
        let pending: Vec<(String, String, u64, u64)> = redis::cmd("XPENDING")
            .arg(&key)
            .arg(&group)
            .arg("-")
            .arg("+")
            .arg(count)
            .query_async(&mut conn)
            .await
            .unwrap_or_default();

        if pending.is_empty() {
            return Ok(vec![]);
        }

        // Filter by idle time and claim
        let mut claimed = vec![];
        for (id, _owner, idle_time, _deliveries) in pending {
            if idle_time >= min_idle_ms {
                let result: redis::Value = redis::cmd("XCLAIM")
                    .arg(&key)
                    .arg(&group)
                    .arg(consumer)
                    .arg(min_idle_ms)
                    .arg(&id)
                    .query_async(&mut conn)
                    .await?;

                if let Ok(messages) = self.parse_xclaim_response::<T>(result) {
                    claimed.extend(messages);
                }
            }
        }

        Ok(claimed)
    }

    /// Get queue length (approximate)
    #[instrument(skip(self))]
    pub async fn len(&self, queue: &str) -> Result<usize, RedisError> {
        let key = self.stream_key(queue);
        let mut conn = self.conn();
        let len: usize = conn.xlen(&key).await?;
        Ok(len)
    }

    /// Get pending message count for a consumer group
    #[instrument(skip(self))]
    pub async fn pending_count(&self, queue: &str) -> Result<usize, RedisError> {
        let key = self.stream_key(queue);
        let group = self.group_name(queue);
        let mut conn = self.conn();

        let result: redis::Value = redis::cmd("XPENDING")
            .arg(&key)
            .arg(&group)
            .query_async(&mut conn)
            .await?;

        // Parse the summary response: [count, first_id, last_id, [[consumer, count], ...]]
        if let redis::Value::Array(arr) = result {
            if let Some(redis::Value::Int(count)) = arr.first() {
                return Ok(*count as usize);
            }
        }
        Ok(0)
    }

    /// Parse XREADGROUP response
    fn parse_stream_response<T: for<'de> Deserialize<'de>>(
        &self,
        value: redis::Value,
    ) -> Result<Vec<(String, QueueMessage<T>)>, RedisError> {
        let mut messages = vec![];

        // Response format: [[stream_name, [[id, [field, value, ...]], ...]]]
        if let redis::Value::Array(streams) = value {
            for stream in streams {
                if let redis::Value::Array(mut parts) = stream {
                    if parts.len() >= 2 {
                        if let redis::Value::Array(entries) = parts.remove(1) {
                            for entry in entries {
                                if let redis::Value::Array(mut entry_parts) = entry {
                                    if entry_parts.len() >= 2 {
                                        let id = match entry_parts.remove(0) {
                                            redis::Value::BulkString(b) => {
                                                String::from_utf8_lossy(&b).to_string()
                                            }
                                            _ => continue,
                                        };

                                        if let redis::Value::Array(fields) = entry_parts.remove(0) {
                                            let data = self.extract_data_field(&fields)?;
                                            if let Some(msg) = self.parse_message(&data)? {
                                                messages.push((id, msg));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(messages)
    }

    /// Parse XCLAIM response
    fn parse_xclaim_response<T: for<'de> Deserialize<'de>>(
        &self,
        value: redis::Value,
    ) -> Result<Vec<(String, QueueMessage<T>)>, RedisError> {
        let mut messages = vec![];

        if let redis::Value::Array(entries) = value {
            for entry in entries {
                if let redis::Value::Array(mut entry_parts) = entry {
                    if entry_parts.len() >= 2 {
                        let id = match entry_parts.remove(0) {
                            redis::Value::BulkString(b) => String::from_utf8_lossy(&b).to_string(),
                            _ => continue,
                        };

                        if let redis::Value::Array(fields) = entry_parts.remove(0) {
                            let data = self.extract_data_field(&fields)?;
                            if let Some(msg) = self.parse_message(&data)? {
                                messages.push((id, msg));
                            }
                        }
                    }
                }
            }
        }

        Ok(messages)
    }

    /// Extract the "data" field from a field/value array
    fn extract_data_field(&self, fields: &[redis::Value]) -> Result<String, RedisError> {
        let mut field_map: HashMap<String, String> = HashMap::new();
        let mut iter = fields.iter();

        while let (Some(key), Some(val)) = (iter.next(), iter.next()) {
            if let (redis::Value::BulkString(k), redis::Value::BulkString(v)) = (key, val) {
                field_map.insert(
                    String::from_utf8_lossy(k).to_string(),
                    String::from_utf8_lossy(v).to_string(),
                );
            }
        }

        field_map
            .remove("data")
            .ok_or_else(|| RedisError::from((redis::ErrorKind::TypeError, "Missing data field")))
    }

    /// Parse a message from JSON
    fn parse_message<T: for<'de> Deserialize<'de>>(
        &self,
        data: &str,
    ) -> Result<Option<QueueMessage<T>>, RedisError> {
        serde_json::from_str(data).map(Some).map_err(|e| {
            RedisError::from((
                redis::ErrorKind::TypeError,
                "JSON parse error",
                e.to_string(),
            ))
        })
    }
}

/// Queue names used in the system
pub mod queues {
    pub const STEPS: &str = "steps";
    pub const DLQ: &str = "dlq";
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // STO-QUE-001: QueueMessage creation
    // ==========================================================================
    #[test]
    fn test_queue_message_new() {
        let msg: QueueMessage<String> = QueueMessage::new("msg_123", "test payload".to_string());
        assert_eq!(msg.id, "msg_123");
        assert_eq!(msg.payload, "test payload");
        assert_eq!(msg.attempts, 0);
        assert!(msg.created_at > 0);
    }

    #[test]
    fn test_queue_message_new_with_string_id() {
        let id = String::from("msg_string_id");
        let msg: QueueMessage<i32> = QueueMessage::new(id, 42);
        assert_eq!(msg.id, "msg_string_id");
        assert_eq!(msg.payload, 42);
    }

    #[test]
    fn test_queue_message_timestamp_is_recent() {
        let before = chrono::Utc::now().timestamp_millis();
        let msg: QueueMessage<()> = QueueMessage::new("test", ());
        let after = chrono::Utc::now().timestamp_millis();

        assert!(msg.created_at >= before);
        assert!(msg.created_at <= after);
    }

    // ==========================================================================
    // STO-QUE-002: QueueMessage serialization
    // ==========================================================================
    #[test]
    fn test_queue_message_serialization() {
        let msg = QueueMessage::new("msg_ser", "hello world".to_string());
        let json = serde_json::to_string(&msg).unwrap();

        assert!(json.contains("msg_ser"));
        assert!(json.contains("hello world"));
        assert!(json.contains("attempts"));
    }

    #[test]
    fn test_queue_message_deserialization() {
        let json = r#"{"id":"msg_de","payload":"test","created_at":1234567890,"attempts":3}"#;
        let msg: QueueMessage<String> = serde_json::from_str(json).unwrap();

        assert_eq!(msg.id, "msg_de");
        assert_eq!(msg.payload, "test");
        assert_eq!(msg.created_at, 1234567890);
        assert_eq!(msg.attempts, 3);
    }

    #[test]
    fn test_queue_message_roundtrip() {
        let original = QueueMessage::new("roundtrip", vec![1, 2, 3]);
        let json = serde_json::to_string(&original).unwrap();
        let parsed: QueueMessage<Vec<i32>> = serde_json::from_str(&json).unwrap();

        assert_eq!(original.id, parsed.id);
        assert_eq!(original.payload, parsed.payload);
        assert_eq!(original.attempts, parsed.attempts);
    }

    // ==========================================================================
    // STO-QUE-003: StepJob creation and serialization
    // ==========================================================================
    #[test]
    fn test_step_job_serialization() {
        let job = StepJob {
            run_id: "run_123".to_string(),
            step_id: "stp_456".to_string(),
            step_type: "llm".to_string(),
            input: serde_json::json!({"prompt": "hello"}),
            context: JobContext {
                tenant_id: "ten_1".to_string(),
                project_id: "prj_1".to_string(),
                trace_id: Some("trace_abc".to_string()),
                span_id: None,
            },
        };

        let json = serde_json::to_string(&job).unwrap();
        assert!(json.contains("run_123"));
        assert!(json.contains("stp_456"));
        assert!(json.contains("llm"));
        assert!(json.contains("ten_1"));
    }

    #[test]
    fn test_step_job_deserialization() {
        let json = r#"{
            "run_id": "run_test",
            "step_id": "stp_test",
            "step_type": "tool",
            "input": {"name": "read_file"},
            "context": {
                "tenant_id": "ten_x",
                "project_id": "prj_x",
                "trace_id": null,
                "span_id": null
            }
        }"#;

        let job: StepJob = serde_json::from_str(json).unwrap();
        assert_eq!(job.run_id, "run_test");
        assert_eq!(job.step_type, "tool");
        assert!(job.context.trace_id.is_none());
    }

    #[test]
    fn test_step_job_roundtrip() {
        let original = StepJob {
            run_id: "run_rt".to_string(),
            step_id: "stp_rt".to_string(),
            step_type: "retrieval".to_string(),
            input: serde_json::json!({"query": "test"}),
            context: JobContext {
                tenant_id: "ten_rt".to_string(),
                project_id: "prj_rt".to_string(),
                trace_id: Some("trace_rt".to_string()),
                span_id: Some("span_rt".to_string()),
            },
        };

        let json = serde_json::to_string(&original).unwrap();
        let parsed: StepJob = serde_json::from_str(&json).unwrap();

        assert_eq!(original.run_id, parsed.run_id);
        assert_eq!(original.context.trace_id, parsed.context.trace_id);
    }

    // ==========================================================================
    // STO-QUE-004: JobContext
    // ==========================================================================
    #[test]
    fn test_job_context_with_all_fields() {
        let ctx = JobContext {
            tenant_id: "ten_full".to_string(),
            project_id: "prj_full".to_string(),
            trace_id: Some("trace_full".to_string()),
            span_id: Some("span_full".to_string()),
        };

        let json = serde_json::to_string(&ctx).unwrap();
        assert!(json.contains("ten_full"));
        assert!(json.contains("trace_full"));
        assert!(json.contains("span_full"));
    }

    #[test]
    fn test_job_context_with_optional_none() {
        let ctx = JobContext {
            tenant_id: "ten_min".to_string(),
            project_id: "prj_min".to_string(),
            trace_id: None,
            span_id: None,
        };

        let json = serde_json::to_string(&ctx).unwrap();
        let parsed: JobContext = serde_json::from_str(&json).unwrap();
        assert!(parsed.trace_id.is_none());
        assert!(parsed.span_id.is_none());
    }

    // ==========================================================================
    // STO-QUE-005: Queue names constants
    // ==========================================================================
    #[test]
    fn test_queue_names_steps() {
        assert_eq!(queues::STEPS, "steps");
    }

    #[test]
    fn test_queue_names_dlq() {
        assert_eq!(queues::DLQ, "dlq");
    }

    // ==========================================================================
    // STO-QUE-006: QueueMessage with complex payload
    // ==========================================================================
    #[test]
    fn test_queue_message_with_step_job_payload() {
        let job = StepJob {
            run_id: "run_complex".to_string(),
            step_id: "stp_complex".to_string(),
            step_type: "llm".to_string(),
            input: serde_json::json!({
                "model": "claude-3-opus",
                "messages": [{"role": "user", "content": "test"}]
            }),
            context: JobContext {
                tenant_id: "ten_c".to_string(),
                project_id: "prj_c".to_string(),
                trace_id: None,
                span_id: None,
            },
        };

        let msg = QueueMessage::new("msg_complex", job);
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: QueueMessage<StepJob> = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.payload.run_id, "run_complex");
        assert_eq!(parsed.payload.context.tenant_id, "ten_c");
    }

    // ==========================================================================
    // STO-QUE-007: Clone and Debug
    // ==========================================================================
    #[test]
    fn test_queue_message_clone() {
        let msg = QueueMessage::new("msg_clone", 42i32);
        let cloned = msg.clone();
        assert_eq!(msg.id, cloned.id);
        assert_eq!(msg.payload, cloned.payload);
    }

    #[test]
    fn test_queue_message_debug() {
        let msg = QueueMessage::new("msg_debug", "payload");
        let debug = format!("{:?}", msg);
        assert!(debug.contains("msg_debug"));
        assert!(debug.contains("payload"));
    }

    #[test]
    fn test_step_job_clone() {
        let job = StepJob {
            run_id: "run_c".to_string(),
            step_id: "stp_c".to_string(),
            step_type: "tool".to_string(),
            input: serde_json::json!({}),
            context: JobContext {
                tenant_id: "t".to_string(),
                project_id: "p".to_string(),
                trace_id: None,
                span_id: None,
            },
        };
        let cloned = job.clone();
        assert_eq!(job.run_id, cloned.run_id);
    }

    #[test]
    fn test_job_context_debug() {
        let ctx = JobContext {
            tenant_id: "ten_dbg".to_string(),
            project_id: "prj_dbg".to_string(),
            trace_id: Some("trace".to_string()),
            span_id: None,
        };
        let debug = format!("{:?}", ctx);
        assert!(debug.contains("ten_dbg"));
    }
}
