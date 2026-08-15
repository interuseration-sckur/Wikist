<?php

namespace app\service;

use app\exception\ApiException;

final class PasswordService
{
    public function hash(string $password): string
    {
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        return password_hash($password, $algorithm);
    }

    public function verify(string $password, string $hash, string $salt = ''): bool
    {
        if ($hash === '') {
            return false;
        }
        if (str_starts_with($hash, '$')) {
            return password_verify($password, $hash);
        }
        if ($salt !== '') {
            return $this->verifyNodeScrypt($password, $salt, $hash);
        }
        return false;
    }

    public function needsRehash(string $hash): bool
    {
        if (!str_starts_with($hash, '$')) {
            return true;
        }
        $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        return password_needs_rehash($hash, $algorithm);
    }

    private function verifyNodeScrypt(string $password, string $salt, string $expected): bool
    {
        if (function_exists('scrypt')) {
            $derived = scrypt($password, $salt, 16384, 8, 1, 64);
            if (!is_string($derived)) {
                return false;
            }
            $encoded = rtrim(strtr(base64_encode($derived), '+/', '-_'), '=');
            return hash_equals($expected, $encoded);
        }

        $baseUrl = rtrim((string) config('wikist.legacy_proxy.url', ''), '/');
        $token = (string) config('wikist.legacy_proxy.token', '');
        $host = strtolower((string) parse_url($baseUrl, PHP_URL_HOST));
        if ($baseUrl === '' || $token === '' || !in_array($host, ['127.0.0.1', 'localhost', '::1'], true) || !function_exists('curl_init')) {
            throw new ApiException(
                '旧版密码迁移服务暂不可用，请联系管理员或使用找回密码。',
                503,
                'legacy_password_migration_unavailable',
            );
        }

        $handle = curl_init($baseUrl . '/api/internal/passport/verify-legacy-password');
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 500,
            CURLOPT_TIMEOUT_MS => 2500,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Wikist-Internal-Token: ' . $token,
            ],
            CURLOPT_POSTFIELDS => json_encode(compact('password', 'salt', 'expected'), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]);
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);
        if (!is_string($response) || $status !== 200) {
            throw new ApiException(
                '旧版密码迁移服务暂不可用，请稍后重试。',
                503,
                'legacy_password_migration_unavailable',
            );
        }
        $payload = json_decode($response, true);
        return is_array($payload) && ($payload['valid'] ?? false) === true;
    }
}
