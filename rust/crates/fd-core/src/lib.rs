//! FerrumDeck Core Library
//!
//! Core primitives for the FerrumDeck AgentOps Control Plane:
//! - ID types (RunId, StepId, AgentId, etc.)
//! - Error types
//! - Configuration
//! - Time utilities

pub mod config;
pub mod error;
pub mod id;
pub mod time;

pub use config::Config;
pub use error::{Error, Result};
pub use id::*;
