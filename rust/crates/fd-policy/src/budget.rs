//! Budget tracking and enforcement

use serde::{Deserialize, Serialize};

/// Budget limits for a run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    /// Maximum input tokens allowed
    pub max_input_tokens: Option<u64>,

    /// Maximum output tokens allowed
    pub max_output_tokens: Option<u64>,

    /// Maximum total tokens (input + output)
    pub max_total_tokens: Option<u64>,

    /// Maximum number of tool calls
    pub max_tool_calls: Option<u32>,

    /// Maximum wall time in milliseconds
    pub max_wall_time_ms: Option<u64>,

    /// Maximum cost in cents (USD)
    pub max_cost_cents: Option<u64>,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            max_input_tokens: Some(100_000),
            max_output_tokens: Some(50_000),
            max_total_tokens: Some(150_000),
            max_tool_calls: Some(50),
            max_wall_time_ms: Some(5 * 60 * 1000), // 5 minutes
            max_cost_cents: Some(500),             // $5
        }
    }
}

/// Current usage against budget
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BudgetUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tool_calls: u32,
    pub wall_time_ms: u64,
    pub cost_cents: u64,
}

impl BudgetUsage {
    pub fn total_tokens(&self) -> u64 {
        self.input_tokens + self.output_tokens
    }

    /// Check if any budget limit is exceeded
    pub fn check_against(&self, budget: &Budget) -> Option<BudgetExceeded> {
        if let Some(limit) = budget.max_input_tokens {
            if self.input_tokens > limit {
                return Some(BudgetExceeded::InputTokens {
                    used: self.input_tokens,
                    limit,
                });
            }
        }

        if let Some(limit) = budget.max_output_tokens {
            if self.output_tokens > limit {
                return Some(BudgetExceeded::OutputTokens {
                    used: self.output_tokens,
                    limit,
                });
            }
        }

        if let Some(limit) = budget.max_total_tokens {
            if self.total_tokens() > limit {
                return Some(BudgetExceeded::TotalTokens {
                    used: self.total_tokens(),
                    limit,
                });
            }
        }

        if let Some(limit) = budget.max_tool_calls {
            if self.tool_calls > limit {
                return Some(BudgetExceeded::ToolCalls {
                    used: self.tool_calls,
                    limit,
                });
            }
        }

        if let Some(limit) = budget.max_wall_time_ms {
            if self.wall_time_ms > limit {
                return Some(BudgetExceeded::WallTime {
                    used_ms: self.wall_time_ms,
                    limit_ms: limit,
                });
            }
        }

        if let Some(limit) = budget.max_cost_cents {
            if self.cost_cents > limit {
                return Some(BudgetExceeded::Cost {
                    used_cents: self.cost_cents,
                    limit_cents: limit,
                });
            }
        }

        None
    }
}

/// Which budget was exceeded
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BudgetExceeded {
    InputTokens { used: u64, limit: u64 },
    OutputTokens { used: u64, limit: u64 },
    TotalTokens { used: u64, limit: u64 },
    ToolCalls { used: u32, limit: u32 },
    WallTime { used_ms: u64, limit_ms: u64 },
    Cost { used_cents: u64, limit_cents: u64 },
}

impl std::fmt::Display for BudgetExceeded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BudgetExceeded::InputTokens { used, limit } => {
                write!(f, "input tokens exceeded: {used}/{limit}")
            }
            BudgetExceeded::OutputTokens { used, limit } => {
                write!(f, "output tokens exceeded: {used}/{limit}")
            }
            BudgetExceeded::TotalTokens { used, limit } => {
                write!(f, "total tokens exceeded: {used}/{limit}")
            }
            BudgetExceeded::ToolCalls { used, limit } => {
                write!(f, "tool calls exceeded: {used}/{limit}")
            }
            BudgetExceeded::WallTime { used_ms, limit_ms } => {
                write!(f, "wall time exceeded: {used_ms}ms/{limit_ms}ms")
            }
            BudgetExceeded::Cost {
                used_cents,
                limit_cents,
            } => {
                write!(
                    f,
                    "cost exceeded: ${:.2}/${:.2}",
                    *used_cents as f64 / 100.0,
                    *limit_cents as f64 / 100.0
                )
            }
        }
    }
}
