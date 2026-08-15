<?php

namespace app\repository;

use app\exception\ApiException;
use support\Db;

final class PassportTokenRepository
{
    private function query()
    {
        return Db::connection(config('wikist.passport.connection', 'wikist'))->table('passport_tokens');
    }

    public function create(int $userId, string $purpose, string $email, int $ttl): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(36)), '+/', '-_'), '=');
        $now = gmdate('c');
        $expiresAt = gmdate('c', time() + max(60, $ttl));
        $this->query()->insert([
            'user_id' => $userId,
            'purpose' => $purpose,
            'token_hash' => $this->hash($token),
            'email' => $email,
            'metadata_json' => '{}',
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'used_at' => '',
        ]);
        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    public function consume(string $token, string $purpose): object
    {
        $row = $this->query()->where('token_hash', $this->hash($token))->where('purpose', $purpose)->first();
        if (!$row || $row->used_at !== '' || $row->expires_at < gmdate('c')) {
            throw new ApiException('验证链接已失效，请重新申请。', 422, 'passport_token_invalid');
        }
        $this->query()->where('id', $row->id)->update(['used_at' => gmdate('c')]);
        return $row;
    }

    public function invalidate(int $userId, string $purpose): void
    {
        $this->query()->where('user_id', $userId)->where('purpose', $purpose)->where('used_at', '')->update(['used_at' => gmdate('c')]);
    }

    private function hash(string $token): string
    {
        $raw = hash('sha256', 'passport-token:' . $token . ':' . config('wikist.secret'), true);
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
