<?php

namespace app\repository;

use app\domain\passport\UserIdentity;
use support\Db;

final class CompatibilitySessionRepository
{
    public function __construct(private readonly UserRepository $users = new UserRepository())
    {
    }

    public function resolve(string $token): ?UserIdentity
    {
        if ($token === '') {
            return null;
        }
        $hash = self::base64Url(hash('sha256', $token, true));
        $row = Db::connection(config('wikist.legacy_bridge.connection', 'wikist'))
            ->table('sessions')
            ->join('users', 'users.id', '=', 'sessions.user_id')
            ->where('sessions.token_hash', $hash)
            ->where('sessions.expires_at', '>', gmdate('c'))
            ->select('users.*')
            ->first();
        return $this->users->identity($row);
    }

    /** @return array{token:string,expiresAt:string} */
    public function create(int $userId, string $ip, string $userAgent): array
    {
        $token = self::base64Url(random_bytes(32));
        $now = gmdate('c');
        $expiresAt = gmdate('c', time() + (int) config('session.lifetime', 604800));
        Db::connection(config('wikist.legacy_bridge.connection', 'wikist'))->table('sessions')->insert([
            'id' => self::uuid(),
            'user_id' => $userId,
            'token_hash' => self::base64Url(hash('sha256', $token, true)),
            'user_agent' => mb_substr($userAgent, 0, 500),
            'ip' => mb_substr($ip, 0, 64),
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'last_seen_at' => $now,
        ]);
        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    public function delete(string $token): void
    {
        if ($token === '') {
            return;
        }
        Db::connection(config('wikist.legacy_bridge.connection', 'wikist'))
            ->table('sessions')
            ->where('token_hash', self::base64Url(hash('sha256', $token, true)))
            ->delete();
    }

    private static function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }
}
