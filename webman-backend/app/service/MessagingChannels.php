<?php

namespace app\service;

final class MessagingChannels
{
    public static function personal(int $userId): string
    {
        return 'personal:user:' . $userId;
    }

    public static function conversation(string $publicId): string
    {
        return 'conversation:' . $publicId;
    }

    public static function organizationActivity(int $organizationId): string
    {
        return 'organization:' . $organizationId . ':activity';
    }

    public static function site(): string
    {
        return 'system:site';
    }
}
