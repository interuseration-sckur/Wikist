<?php

namespace app\service;

final class RealtimeSecurityService
{
    public function disconnectUser(int $userId, string $reason): void
    {
        try {
            (new CentrifugoPublisher())->disconnectUser($userId, $reason);
        } catch (\Throwable $error) {
            error_log('Wikist realtime disconnect failed: ' . SensitiveDataRedactor::text($error->getMessage()));
        }
    }
}
