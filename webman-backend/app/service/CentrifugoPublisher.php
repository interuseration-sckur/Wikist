<?php

namespace app\service;

final class CentrifugoPublisher
{
    public function enabled(): bool
    {
        return (bool) config('wikist.centrifugo.enabled', false);
    }

    public function publish(string $channel, array $data, string $idempotencyKey = ''): array
    {
        if (!$this->enabled()) {
            return ['published' => false, 'transport' => 'disabled'];
        }
        $payload = ['channel' => $channel, 'data' => $data];
        if ($idempotencyKey !== '') {
            $payload['idempotency_key'] = $idempotencyKey;
        }
        return $this->call('publish', $payload);
    }

    public function presence(string $channel): array
    {
        if (!$this->enabled()) {
            return ['presence' => [], 'transport' => 'disabled'];
        }
        $response = $this->call('presence', ['channel' => $channel]);
        return is_array($response['presence'] ?? null) ? $response : ['presence' => []];
    }

    public function disconnectUser(int $userId, string $reason = 'Account security changed'): array
    {
        if (!$this->enabled()) {
            return ['disconnected' => false, 'transport' => 'disabled'];
        }
        return $this->call('disconnect', [
            'user' => (string) $userId,
            'disconnect' => ['code' => 3500, 'reason' => mb_substr($reason, 0, 120)],
        ]);
    }

    private function call(string $method, array $payload): array
    {
        $base = rtrim((string) config('wikist.centrifugo.api_url', 'http://127.0.0.1:8000/api'), '/');
        $parts = parse_url($base);
        if (!in_array(strtolower((string) ($parts['host'] ?? '')), ['127.0.0.1', '::1', 'localhost'], true)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])) {
            throw new \RuntimeException('Centrifugo API must use a loopback address.');
        }
        $handle = curl_init($base . '/' . rawurlencode($method));
        if ($handle === false) {
            throw new \RuntimeException('无法初始化 Centrifugo 请求。');
        }
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-API-Key: ' . (string) config('wikist.centrifugo.api_key', ''),
            ],
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_CONNECTTIMEOUT_MS => max(100, (int) config('wikist.centrifugo.connect_timeout_ms', 800)),
            CURLOPT_TIMEOUT_MS => max(300, (int) config('wikist.centrifugo.timeout_ms', 2500)),
        ]);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if ($raw === false || $error !== '') {
            throw new \RuntimeException('Centrifugo 连接失败：' . ($error ?: 'unknown error'));
        }
        $decoded = json_decode((string) $raw, true);
        if ($status < 200 || $status >= 300 || !is_array($decoded) || isset($decoded['error'])) {
            $message = is_array($decoded) ? (string) ($decoded['error']['message'] ?? $decoded['error'] ?? '') : '';
            throw new \RuntimeException('Centrifugo API 返回异常（HTTP ' . $status . '）' . ($message !== '' ? '：' . $message : ''));
        }
        return is_array($decoded['result'] ?? null) ? $decoded['result'] : $decoded;
    }
}
