<?php

namespace app\service;

final class SecretCipher
{
    public function encrypt(string $value): string
    {
        if ($value === '') {
            return '';
        }
        $iv = random_bytes(12);
        $tag = '';
        $encrypted = openssl_encrypt($value, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($encrypted === false) {
            throw new \RuntimeException('无法加密二次验证密钥。');
        }
        return 'v1:' . $this->encode($iv) . ':' . $this->encode($tag) . ':' . $this->encode($encrypted);
    }

    public function decrypt(string $value): string
    {
        $parts = explode(':', $value);
        if (count($parts) !== 4 || $parts[0] !== 'v1') {
            return '';
        }
        $decrypted = openssl_decrypt(
            $this->decode($parts[3]),
            'aes-256-gcm',
            $this->key(),
            OPENSSL_RAW_DATA,
            $this->decode($parts[1]),
            $this->decode($parts[2]),
        );
        return is_string($decrypted) ? $decrypted : '';
    }

    private function key(): string
    {
        return hash('sha256', config('wikist.secret') . ':wikist-secret-v1', true);
    }

    private function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function decode(string $value): string
    {
        return base64_decode(strtr($value, '-_', '+/')) ?: '';
    }
}
