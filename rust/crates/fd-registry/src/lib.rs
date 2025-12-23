//! FerrumDeck Registry
//!
//! Versioned registry for agents, tools, and prompts.
//! All configurations are immutable once created.

pub mod agent;
pub mod tool;
pub mod version;

pub use agent::Agent;
pub use tool::Tool;
