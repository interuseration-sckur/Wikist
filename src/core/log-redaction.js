"use strict";

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|captcha|totp|recovery|smtp|api[_-]?key|session|email)/i;

function redactString(value) {
  return String(value || "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/([?&](?:token|secret|password|key|code)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(?:password|passwd|secret|token|captcha|totp|recovery_code|api[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi, (match) => `${match.slice(0, match.search(/[:=]/) + 1)}[redacted]`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .slice(0, 1200);
}

function redactLogValue(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(String(key || ""))) return "[redacted]";
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactLogValue(item, "", depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    Object.entries(value).slice(0, 80).forEach(([childKey, childValue]) => {
      output[childKey] = redactLogValue(childValue, childKey, depth + 1);
    });
    return output;
  }
  return value;
}

module.exports = { redactLogValue, redactString };
