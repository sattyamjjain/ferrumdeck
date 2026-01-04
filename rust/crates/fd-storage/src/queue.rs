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
