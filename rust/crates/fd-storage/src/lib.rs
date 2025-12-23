//! FerrumDeck Storage Layer
//!
//! PostgreSQL repositories for all FerrumDeck entities.
//! Uses SQLx for compile-time checked queries.

pub mod models;
pub mod pool;
pub mod queue;
pub mod repos;

pub use pool::{create_pool, DbPool};
pub use queue::{QueueClient, QueueMessage};
pub use repos::*;
