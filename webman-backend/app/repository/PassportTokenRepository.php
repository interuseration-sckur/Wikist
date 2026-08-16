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
        $connection = Db::connection(config('wikist.passport.connection', 'wikist'));
        $connection->transaction(function () use ($connection, $userId, $purpose, $email, $token, $now, $expiresAt): void {
            $connection->table('passport_tokens')
                ->where('user_id', $userId)->where('purpose', $purpose)->where('used_at', '')
                ->update(['used_at' => $now]);
            $connection->table('passport_tokens')->insert([
                'user_id' => $userId,
                'purpose' => $purpose,
                'token_hash' => $this->hash($token),
                'email' => $email,
                'metadata_json' => '{}',
                'created_at' => $now,
                'expires_at' => $expiresAt,
                'used_at' => '',
            ]);
        });
        return ['token' => $token, 'expiresAt' => $expiresAt];
    }

    public function consume(string $token, string $purpose): object
    {
        return $this->consumeAny($token, [$purpose]);
    }

    public function consumeAny(string $token, array $purposes): object
    {
        $purposes = array_values(array_unique(array_filter(array_map('strval', $purposes))));
        $now = gmdate('c');
        $row = $this->query()->where('token_hash', $this->hash($token))->whereIn('purpose', $purposes)->first();
        if (!$row || $row->used_at !== '' || $row->expires_at < $now) {
            throw new ApiException('验证链接已失效，请重新申请。', 422, 'passport_token_invalid');
        }
        $updated = $this->query()
            ->where('id', $row->id)
            ->where('used_at', '')
            ->where('expires_at', '>=', $now)
            ->update(['used_at' => $now]);
        if ($updated !== 1) {
            throw new ApiException('验证链接已失效，请重新申请。', 422, 'passport_token_invalid');
        }
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
