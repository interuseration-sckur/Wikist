<?php

namespace app\http;

use support\Response;

final class ApiResponse
{
    public static function data(array $data = [], int $status = 200, array $headers = []): Response
    {
        return new Response(
            $status,
            array_replace([
                'Content-Type' => 'application/json; charset=utf-8',
                'X-Wikist-Backend' => 'webman',
            ], $headers),
            json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        );
    }

    public static function error(string $message, int $status, string $code, array $details = []): Response
    {
        $payload = ['error' => $message, 'code' => $code];
        if ($details !== []) {
            $payload['details'] = $details;
        }
        return self::data($payload, $status);
    }
}
