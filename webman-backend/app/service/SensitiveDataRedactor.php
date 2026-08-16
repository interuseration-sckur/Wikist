<?php

namespace app\service;

final class SensitiveDataRedactor
{
    public static function text(string $value): string
    {
        $value = preg_replace('/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=\-]+/iu', '$1 [redacted]', $value) ?? '';
        $value = preg_replace('/([?&](?:token|secret|password|key|code)=)[^&#\s]+/iu', '$1[redacted]', $value) ?? '';
        $value = preg_replace('/\b(?:password|passwd|secret|token|captcha|totp|recovery_code|api[_-]?key)\b\s*[:=]\s*([^\s,;]+)/iu', '$0', $value) ?? '';
        $value = preg_replace_callback(
            '/\b(?:password|passwd|secret|token|captcha|totp|recovery_code|api[_-]?key)\b\s*[:=]\s*([^\s,;]+)/iu',
            static fn (array $match): string => preg_replace('/[^:=]+$/u', '[redacted]', $match[0]) ?? '[redacted]',
            $value,
        ) ?? '';
        $value = preg_replace('/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/iu', '[redacted-email]', $value) ?? '';
        return mb_substr($value, 0, 1200);
    }

    public static function context(array $context, int $depth = 0): array
    {
        if ($depth > 5) {
            return ['value' => '[truncated]'];
        }
        $output = [];
        foreach (array_slice($context, 0, 80, true) as $key => $value) {
            if (preg_match('/authorization|cookie|password|passwd|secret|token|captcha|totp|recovery|smtp|api[_-]?key|session|email/iu', (string) $key)) {
                $output[$key] = '[redacted]';
            } elseif (is_array($value)) {
                $output[$key] = self::context($value, $depth + 1);
            } elseif (is_string($value)) {
                $output[$key] = self::text($value);
            } else {
                $output[$key] = $value;
            }
        }
        return $output;
    }
}
