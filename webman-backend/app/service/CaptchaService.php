<?php

namespace app\service;

use app\exception\ApiException;
use support\Request;

final class CaptchaService
{
    private const TTL = 300;

    public function create(Request $request): array
    {
        $id = bin2hex(random_bytes(16));
        $left = random_int(11, 79);
        $right = random_int(3, 38);
        $operator = random_int(0, 1) === 1 ? '+' : '-';
        $answer = $operator === '+' ? $left + $right : $left - $right;
        $expiresAt = time() + self::TTL;
        $request->session()->set('passport.captcha', [
            'id' => $id,
            'hash' => hash_hmac('sha256', $id . ':' . $answer, config('wikist.secret')),
            'expires_at' => $expiresAt,
        ]);
        return [
            'id' => $id,
            'svg' => $this->svg("{$left} {$operator} {$right}"),
            'expiresAt' => gmdate('c', $expiresAt),
        ];
    }

    public function verify(Request $request, string $id, string $answer): void
    {
        $challenge = $request->session()->pull('passport.captcha');
        if (!is_array($challenge) || ($challenge['id'] ?? '') !== $id || ($challenge['expires_at'] ?? 0) < time()) {
            throw new ApiException('验证码已失效，请刷新后重试。', 422, 'captcha_expired');
        }
        $actual = hash_hmac('sha256', $id . ':' . trim($answer), config('wikist.secret'));
        if (!hash_equals((string) $challenge['hash'], $actual)) {
            throw new ApiException('验证码不正确。', 422, 'captcha_invalid');
        }
    }

    public function verifyInput(Request $request, array $input): void
    {
        $behaviorVerification = trim((string) ($input['captchaVerification'] ?? ''));
        if ($behaviorVerification !== '') {
            (new BehaviorCaptchaService())->verify($request, $behaviorVerification);
            return;
        }
        $this->verify(
            $request,
            (string) ($input['captchaId'] ?? ''),
            (string) ($input['captchaAnswer'] ?? ''),
        );
    }

    private function svg(string $question): string
    {
        $question = htmlspecialchars($question, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        return '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="118" viewBox="0 0 300 118" role="img" aria-label="Wikist captcha">'
            . '<rect width="300" height="118" rx="8" fill="#080d0c"/>'
            . '<path d="M8 26H292M8 59H292M8 92H292M54 8V110M150 8V110M246 8V110" stroke="#123b3d" opacity=".65"/>'
            . '<rect x="8" y="8" width="284" height="102" rx="6" fill="none" stroke="#38e8ff" opacity=".34"/>'
            . '<text x="18" y="31" font-family="Segoe UI,Arial" font-size="12" fill="#9bb0a8">PASSPORT CHECK</text>'
            . '<text x="150" y="78" text-anchor="middle" font-family="Consolas,monospace" font-size="34" font-weight="700" fill="#edf7f2">'
            . $question . ' = ?</text></svg>';
    }
}
