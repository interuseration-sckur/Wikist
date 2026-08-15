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
            'metadata_json' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'ip' => $request->getRealIp(),
            'user_agent' => mb_substr((string) $request->header('user-agent'), 0, 500),
            'created_at' => gmdate('c'),
        ]);
    }
}
