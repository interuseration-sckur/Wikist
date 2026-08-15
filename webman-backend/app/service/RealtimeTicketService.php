<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

final class RealtimeTicketService
{
    public function issue(UserIdentity $identity): string
    {
        $now = time();
        return JWT::encode([
            'iss' => config('wikist.url'),
            'aud' => 'wikist-realtime',
            'sub' => (string) $identity->id,
            'username' => $identity->username,
            'role' => $identity->role,
            'iat' => $now,
            'exp' => $now + (int) config('wikist.realtime.ticket_ttl', 60),
            'jti' => bin2hex(random_bytes(12)),
        ], config('wikist.secret'), 'HS256');
    }

    public function verify(string $ticket): object
    {
        $claims = JWT::decode($ticket, new Key(config('wikist.secret'), 'HS256'));
        if (($claims->aud ?? '') !== 'wikist-realtime') {
            throw new \UnexpectedValueException('Invalid realtime audience');
        }
        return $claims;
    }
}
