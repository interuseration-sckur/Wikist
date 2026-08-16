<?php

namespace app\repository;

use app\domain\passport\UserIdentity;
use support\Db;
use support\Request;

final class AuditRepository
{
    public function record(Request $request, UserIdentity $actor, string $action, string $targetType, string $targetId, string $summary, array $metadata = []): void
    {
        $connection = config('wikist.passport.connection', 'wikist');
        $schema = Db::connection($connection)->getSchemaBuilder();
        if (!$schema->hasTable('site_audit_logs')) {
            return;
        }
        Db::connection($connection)->table('site_audit_logs')->insert([
            'actor_type' => 'user',
            'user_id' => $actor->id,
            'guest_id' => null,
            'actor_name' => $actor->displayName,
            'actor_label' => '@' . $actor->username,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'target_label' => $targetId,
            'summary' => $summary,
            'metadata_json' => json_encode($this->redact($metadata), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'ip' => $this->maskIp((string) ($request->clientIp ?? $request->getRemoteIp())),
            'user_agent' => mb_substr((string) $request->header('user-agent'), 0, 180),
            'created_at' => gmdate('c'),
        ]);
        if (random_int(0, 127) === 0) {
            $days = max(30, min((int) (getenv('AUDIT_RETENTION_DAYS') ?: 180), 3650));
            Db::connection($connection)->table('site_audit_logs')
                ->where('created_at', '<', gmdate('c', time() - ($days * 86400)))
                ->delete();
        }
    }

    private function redact(mixed $value, string $key = '', int $depth = 0): mixed
    {
        if (preg_match('/authorization|cookie|password|secret|token|captcha|totp|recovery|smtp|email/i', $key)) {
            return '[REDACTED]';
        }
        if ($depth >= 4) {
            return '[TRUNCATED]';
        }
        if (!is_array($value)) {
            return is_string($value) ? mb_substr($value, 0, 1000) : $value;
        }
        $result = [];
        foreach (array_slice($value, 0, 80, true) as $name => $item) {
            $result[$name] = $this->redact($item, (string) $name, $depth + 1);
        }
        return $result;
    }

    private function maskIp(string $value): string
    {
        $ip = preg_replace('/^::ffff:/i', '', trim($value));
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return preg_replace('/\.\d+$/', '.0', $ip);
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return implode(':', array_slice(explode(':', $ip), 0, 3)) . '::';
        }
        return '';
    }
}
