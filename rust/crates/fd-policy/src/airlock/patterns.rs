//! Anti-RCE pattern matching
//!
//! Detects potentially dangerous code patterns in tool call payloads:
//! - eval()/exec() calls
//! - Base64 obfuscation patterns
//! - Shell injection (pipes, redirects, command substitution)
//! - Python injection (__import__, subprocess, os.system)
//! - Path traversal

use super::config::RceConfig;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use regex::Regex;
use std::sync::OnceLock;
use tracing::debug;

/// Compiled pattern with metadata
struct CompiledPattern {
    regex: Regex,
    name: &'static str,
    risk_score: u8,
    description: &'static str,
}

/// Get built-in dangerous patterns (compiled once)
fn get_builtin_patterns() -> &'static [CompiledPattern] {
    static PATTERNS: OnceLock<Vec<CompiledPattern>> = OnceLock::new();

    PATTERNS.get_or_init(|| {
        vec![
            // =================================================================
            // Python eval/exec patterns (Critical - 90+ risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(r#"(?i)\beval\s*\("#).unwrap(),
                name: "python_eval",
                risk_score: 90,
                description: "Python eval() function detected - allows arbitrary code execution",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)\bexec\s*\("#).unwrap(),
                name: "python_exec",
                risk_score: 90,
                description: "Python exec() function detected - allows arbitrary code execution",
            },
            CompiledPattern {
                regex: Regex::new(
                    r#"(?i)\bcompile\s*\([^)]*,\s*['"][^'"]*['"],\s*['"]exec['"]\s*\)"#,
                )
                .unwrap(),
                name: "python_compile_exec",
                risk_score: 90,
                description: "Python compile() with exec mode detected",
            },
            // =================================================================
            // Base64 obfuscation patterns (Critical - 95 risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(
                    r#"(?i)base64\s*[\.\[].*\b(decode|b64decode)\b.*\b(eval|exec)\b"#,
                )
                .unwrap(),
                name: "base64_eval_combo",
                risk_score: 95,
                description: "Base64 decode + eval/exec pattern (obfuscation attempt)",
            },
            CompiledPattern {
                regex: Regex::new(
                    r#"(?i)\b(eval|exec)\b.*base64\s*[\.\[].*\b(decode|b64decode)\b"#,
                )
                .unwrap(),
                name: "eval_base64_combo",
                risk_score: 95,
                description: "Eval/exec + base64 decode pattern (obfuscation attempt)",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)atob\s*\([^)]+\)\s*\)"#).unwrap(),
                name: "js_atob_eval",
                risk_score: 85,
                description: "JavaScript atob (base64 decode) detected",
            },
            // =================================================================
            // Shell injection patterns (High - 70-85 risk)
            // =================================================================
            CompiledPattern {
                // Matches: ; command, && command, || command
                regex: Regex::new(r#"[;&|]{1,2}\s*\w+\s"#).unwrap(),
                name: "shell_chaining",
                risk_score: 75,
                description: "Shell command chaining detected (;, &&, ||)",
            },
            CompiledPattern {
                // Matches: > /path or >> /path (file redirect)
                regex: Regex::new(r#">{1,2}\s*/[a-zA-Z]"#).unwrap(),
                name: "file_redirect",
                risk_score: 70,
                description: "Shell file redirect to absolute path detected",
            },
            CompiledPattern {
                // Matches: $(command) substitution
                regex: Regex::new(r#"\$\([^)]+\)"#).unwrap(),
                name: "command_substitution",
                risk_score: 80,
                description: "Shell command substitution $() detected",
            },
            CompiledPattern {
                // Matches: `command` backtick substitution
                regex: Regex::new(r#"`[^`]+`"#).unwrap(),
                name: "backtick_substitution",
                risk_score: 80,
                description: "Shell backtick command substitution detected",
            },
            CompiledPattern {
                // Matches: | pipe
                regex: Regex::new(r#"\|\s*\w+"#).unwrap(),
                name: "shell_pipe",
                risk_score: 65,
                description: "Shell pipe detected",
            },
            // =================================================================
            // Python injection patterns (High - 75-85 risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(r#"(?i)__import__\s*\("#).unwrap(),
                name: "python_import_injection",
                risk_score: 85,
                description: "Python __import__ injection pattern detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)subprocess\s*\.\s*(call|run|Popen|check_output)"#)
                    .unwrap(),
                name: "subprocess_call",
                risk_score: 80,
                description: "Python subprocess execution detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)os\s*\.\s*(system|popen|exec[lv]?[pe]?)"#).unwrap(),
                name: "os_exec",
                risk_score: 85,
                description: "Python os module shell execution detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)commands\s*\.\s*(getoutput|getstatusoutput)"#).unwrap(),
                name: "commands_module",
                risk_score: 75,
                description: "Python commands module (deprecated shell execution) detected",
            },
            // =================================================================
            // Path traversal patterns (High - 80 risk)
            // =================================================================
            CompiledPattern {
                // Matches: ../, ..\, ..%2f, ..%2F
                regex: Regex::new(r#"\.\./|\.\.\\|\.\.\%2[fF]"#).unwrap(),
                name: "path_traversal",
                risk_score: 80,
                description: "Path traversal pattern detected (../)",
            },
            CompiledPattern {
                // Matches paths starting with /etc, /var, /root, /home
                regex: Regex::new(r#"(?i)['"](/etc/|/var/|/root/|/home/|/proc/|/sys/)"#).unwrap(),
                name: "sensitive_path_access",
                risk_score: 70,
                description: "Access to sensitive system path detected",
            },
            // =================================================================
            // Environment variable exfiltration (Medium - 50-60 risk)
            // =================================================================
            CompiledPattern {
                // Matches: $VAR, ${VAR}, %VAR%
                regex: Regex::new(r#"\$\{?(API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|AWS_)\w*\}?"#)
                    .unwrap(),
                name: "sensitive_env_var",
                risk_score: 70,
                description: "Access to sensitive environment variable detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)os\s*\.\s*(environ|getenv)\s*\["#).unwrap(),
                name: "env_access",
                risk_score: 50,
                description: "Environment variable access detected",
            },
            // =================================================================
            // Network/Socket patterns (Medium-High - 60-75 risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(r#"(?i)socket\s*\.\s*(socket|connect|bind|listen)"#).unwrap(),
                name: "raw_socket",
                risk_score: 75,
                description: "Raw socket operation detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)(urllib|requests|httplib|http\.client)\s*\.\s*\w+"#)
                    .unwrap(),
                name: "network_library",
                risk_score: 50,
                description: "Network library usage detected",
            },
            // =================================================================
            // Code injection vectors (High - 75-85 risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(r#"(?i)<\s*script[^>]*>"#).unwrap(),
                name: "script_tag",
                risk_score: 75,
                description: "HTML script tag detected (potential XSS)",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)javascript\s*:"#).unwrap(),
                name: "javascript_url",
                risk_score: 70,
                description: "JavaScript URL protocol detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"(?i)data\s*:\s*text/html"#).unwrap(),
                name: "data_url_html",
                risk_score: 65,
                description: "Data URL with HTML content detected",
            },
            // =================================================================
            // Template injection (Medium-High - 65-75 risk)
            // =================================================================
            CompiledPattern {
                regex: Regex::new(r#"\{\{[^}]*\}\}"#).unwrap(),
                name: "template_injection",
                risk_score: 65,
                description: "Template injection pattern {{ }} detected",
            },
            CompiledPattern {
                regex: Regex::new(r#"\$\{[^}]*\}"#).unwrap(),
                name: "string_interpolation",
                risk_score: 55,
                description: "String interpolation pattern ${ } detected",
            },
        ]
    })
}

/// RCE pattern matcher
pub struct RcePatternMatcher {
    target_tools: Vec<String>,
    custom_patterns: Vec<(Regex, String)>,
}

impl RcePatternMatcher {
    /// Create a new pattern matcher from config
    pub fn new(config: &RceConfig) -> Self {
        let custom_patterns = config
            .custom_patterns
            .iter()
            .filter_map(|p| Regex::new(p).ok().map(|r| (r, p.clone())))
            .collect();

        Self {
            target_tools: config.target_tools.clone(),
            custom_patterns,
        }
    }

    /// Check if this tool should be inspected
    fn should_inspect(&self, tool_name: &str) -> bool {
        self.target_tools.iter().any(|t| t == tool_name)
    }

    /// Extract all text content from JSON for pattern matching
    fn extract_text_content(value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(arr) => arr
                .iter()
                .map(Self::extract_text_content)
                .collect::<Vec<_>>()
                .join("\n"),
            serde_json::Value::Object(obj) => obj
                .values()
                .map(Self::extract_text_content)
                .collect::<Vec<_>>()
                .join("\n"),
            _ => String::new(),
        }
    }

    /// Check tool input for RCE patterns
    pub fn check(
        &self,
        tool_name: &str,
        tool_input: &serde_json::Value,
    ) -> Option<AirlockViolation> {
        if !self.should_inspect(tool_name) {
            return None;
        }

        let text = Self::extract_text_content(tool_input);
        if text.is_empty() {
            return None;
        }

        // Check built-in patterns
        for pattern in get_builtin_patterns() {
            if pattern.regex.is_match(&text) {
                debug!(
                    tool = tool_name,
                    pattern = pattern.name,
                    "RCE pattern detected"
                );

                return Some(AirlockViolation {
                    violation_type: ViolationType::RcePattern,
                    risk_score: pattern.risk_score,
                    risk_level: RiskLevel::from_score(pattern.risk_score),
                    details: pattern.description.to_string(),
                    trigger: pattern.name.to_string(),
                });
            }
        }

        // Check custom patterns
        for (regex, pattern_str) in &self.custom_patterns {
            if regex.is_match(&text) {
                debug!(
                    tool = tool_name,
                    pattern = pattern_str,
                    "Custom RCE pattern detected"
                );

                return Some(AirlockViolation {
                    violation_type: ViolationType::RcePattern,
                    risk_score: 80, // Default score for custom patterns
                    risk_level: RiskLevel::High,
                    details: format!("Custom pattern match: {}", pattern_str),
                    trigger: format!("custom:{}", pattern_str),
                });
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_matcher() -> RcePatternMatcher {
        RcePatternMatcher::new(&RceConfig::default())
    }

    #[test]
    fn test_eval_detection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "content": "result = eval(user_input)"
        });

        let result = matcher.check("write_file", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::RcePattern);
        assert!(violation.risk_score >= 90);
        assert!(violation.trigger.contains("eval"));
    }

    #[test]
    fn test_exec_detection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "code": "exec(compile(source, '<string>', 'exec'))"
        });

        let result = matcher.check("python_repl", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_base64_eval_combo() {
        let matcher = create_matcher();
        // This pattern has base64.decode before eval, matching base64_eval_combo
        let input = serde_json::json!({
            "script": "exec(base64.b64decode(encoded_payload).decode())"
        });

        let result = matcher.check("bash", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        // Either base64+eval combo (95) or exec pattern (90) is valid
        assert!(violation.risk_score >= 90);
        assert!(
            violation.trigger.contains("eval")
                || violation.trigger.contains("exec")
                || violation.trigger.contains("base64")
        );
    }

    #[test]
    fn test_command_substitution() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "command": "echo $(cat /etc/passwd)"
        });

        let result = matcher.check("bash", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_path_traversal() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "path": "../../../etc/passwd"
        });

        let result = matcher.check("write_file", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        assert!(violation.trigger.contains("path_traversal"));
    }

    #[test]
    fn test_subprocess_detection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "code": "subprocess.run(['rm', '-rf', '/'])"
        });

        let result = matcher.check("python_repl", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_os_system_detection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "script": "os.system('whoami')"
        });

        let result = matcher.check("execute_command", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_safe_content_allowed() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "content": "def hello():\n    print('Hello, World!')\n\nhello()"
        });

        let result = matcher.check("write_file", &input);
        assert!(result.is_none());
    }

    #[test]
    fn test_non_target_tool_skipped() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "query": "eval(dangerous_code)"
        });

        // read_file is not in target tools
        let result = matcher.check("read_file", &input);
        assert!(result.is_none());
    }

    #[test]
    fn test_nested_json_extraction() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "outer": {
                "inner": {
                    "content": "eval(payload)"
                }
            }
        });

        let result = matcher.check("write_file", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_array_content_extraction() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "files": [
                {"name": "safe.txt", "content": "hello"},
                {"name": "dangerous.py", "content": "exec(code)"}
            ]
        });

        let result = matcher.check("create_file", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_shell_pipe_detection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "command": "cat file.txt | grep password"
        });

        let result = matcher.check("bash", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_import_injection() {
        let matcher = create_matcher();
        let input = serde_json::json!({
            "code": "__import__('os').system('id')"
        });

        let result = matcher.check("python_repl", &input);
        assert!(result.is_some());
    }
}
