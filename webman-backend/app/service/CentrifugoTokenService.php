<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\repository\MessagingRepository;
use Firebase\JWT\JWT;

final class CentrifugoTokenService
{
    public function __construct(private readonly MessagingRepository $messages = new MessagingRepository())
    {
    }

    public function connectionToken(UserIdentity $identity): array
    {
        $now = time();
        $ttl = max(60, (int) config('wikist.centrifugo.token_ttl', 300));
        $channels = [MessagingChannels::personal($identity->id), MessagingChannels::site()];
        foreach ($this->messages->organizationMemberships($identity->id) as $membership) {
            $channels[] = MessagingChannels::organizationActivity((int) $membership->organization_id);
        }
        $channels = array_values(array_unique($channels));
        $token = JWT::encode([
            'sub' => (string) $identity->id,
            'iat' => $now,
            'exp' => $now + $ttl,
            'info' => [
                'username' => $identity->username,
                'displayName' => $identity->displayName,
                'avatarUrl' => $identity->avatarUrl,
                'role' => $identity->role,
            ],
            'channels' => $channels,
        ], $this->secret(), 'HS256');
        return ['token' => $token, 'expiresIn' => $ttl, 'channels' => $channels];
    }

    public function subscriptionToken(UserIdentity $identity, string $channel): array
    {
        $now = time();
        $ttl = max(60, (int) config('wikist.centrifugo.subscription_ttl', 300));
        return [
            'token' => JWT::encode([
                'sub' => (string) $identity->id,
                'channel' => $channel,
                'iat' => $now,
                'exp' => $now + $ttl,
                'info' => ['role' => $identity->role],
            ], $this->secret(), 'HS256'),
            'expiresIn' => $ttl,
        ];
    }

    private function secret(): string
    {
        $secret = (string) config('wikist.centrifugo.token_hmac_secret', '');
        return $secret !== '' ? $secret : (string) config('wikist.secret');
    }
}
