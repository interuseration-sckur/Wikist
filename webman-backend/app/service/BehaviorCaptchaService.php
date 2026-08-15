<?php

namespace app\service;

use app\exception\ApiException;
use app\repository\SiteConfigRepository;
use Fastknife\Exception\WordException;
use Fastknife\Service\BlockPuzzleCaptchaService;
use Fastknife\Service\ClickWordCaptchaService;
use Fastknife\Utils\AesUtils;
use support\Request;

final class BehaviorCaptchaService
{
    private const SESSION_KEY = 'passport.behavior_captchas';
    private const ISSUED_SESSION_KEY = 'passport.behavior_captcha_issued';
    private const TTL = 300;
    private const MAX_ISSUED = 6;

    public function create(Request $request): array
    {
        $type = random_int(0, 1) === 0 ? 'blockPuzzle' : 'clickWord';
        try {
            $data = $this->service($type)->get();
        } catch (\Throwable $error) {
            throw new ApiException('人机验证暂时无法生成，请稍后重试。', 503, 'captcha_unavailable');
        }

        $token = trim((string) ($data['token'] ?? ''));
        if (!preg_match('/^[A-Fa-f0-9-]{24,64}$/', $token)) {
            throw new ApiException('验证码凭证生成失败，请重试。', 503, 'captcha_unavailable');
        }
        $issued = $this->activeChallenges((array) $request->session()->get(self::ISSUED_SESSION_KEY, []));
        $issued[$this->tokenKey($token)] = ['type' => $type, 'expires_at' => time() + self::TTL];
        if (count($issued) > self::MAX_ISSUED) {
            uasort($issued, static fn (array $left, array $right): int => $left['expires_at'] <=> $right['expires_at']);
            $issued = array_slice($issued, -self::MAX_ISSUED, null, true);
        }
        $request->session()->set(self::ISSUED_SESSION_KEY, $issued);

        $imageSize = $this->imageSize((string) ($data['originalImageBase64'] ?? ''));
        $pieceSize = $type === 'blockPuzzle'
            ? $this->imageSize((string) ($data['jigsawImageBase64'] ?? ''))
            : [null, null];
        unset($data['secretKey']);
        return $data + [
            'type' => $type,
            'imageWidth' => $imageSize[0] ?? 310,
            'imageHeight' => $imageSize[1] ?? 155,
            'pieceWidth' => $pieceSize[0] ?? ($type === 'blockPuzzle' ? 47 : null),
            'expiresAt' => gmdate('c', time() + self::TTL),
        ];
    }

    public function check(Request $request, array $input): array
    {
        $token = trim((string) ($input['token'] ?? ''));
        if (!preg_match('/^[A-Fa-f0-9-]{24,64}$/', $token)) {
            throw new ApiException('验证码令牌无效，请刷新后重试。', 422, 'captcha_invalid');
        }

        $issued = $this->activeChallenges((array) $request->session()->get(self::ISSUED_SESSION_KEY, []));
        $issuedKey = $this->tokenKey($token);
        $challenge = $issued[$issuedKey] ?? null;
        unset($issued[$issuedKey]);
        $request->session()->set(self::ISSUED_SESSION_KEY, $issued);
        if (!is_array($challenge)) {
            throw new ApiException('验证码已失效，请刷新后重试。', 422, 'captcha_expired');
        }
        $type = $this->normalizeType((string) ($challenge['type'] ?? ''));

        $point = $this->normalizePoint($type, $input['point'] ?? null);
        try {
            $verification = $this->service($type)->checkPlain($token, $point);
        } catch (\Throwable $error) {
            throw new ApiException('验证未通过，请重新完成验证。', 422, 'captcha_invalid');
        }
        if (!is_string($verification) || $verification === '') {
            throw new ApiException('验证码凭证生成失败，请重试。', 503, 'captcha_unavailable');
        }

        $challenges = $this->activeChallenges((array) $request->session()->get(self::SESSION_KEY, []));
        $key = $this->verificationKey($verification);
        $challenges[$key] = ['type' => $type, 'expires_at' => time() + self::TTL];
        if (count($challenges) > 4) {
            uasort($challenges, static fn (array $left, array $right): int => $left['expires_at'] <=> $right['expires_at']);
            $challenges = array_slice($challenges, -4, null, true);
        }
        $request->session()->set(self::SESSION_KEY, $challenges);

        return [
            'verified' => true,
            'captchaVerification' => $verification,
            'expiresAt' => gmdate('c', time() + self::TTL),
        ];
    }

    public function verify(Request $request, string $verification): void
    {
        $verification = trim($verification);
        if ($verification === '') {
            throw new ApiException('请先完成人机验证。', 422, 'captcha_required');
        }

        $challenges = $this->activeChallenges((array) $request->session()->get(self::SESSION_KEY, []));
        $key = $this->verificationKey($verification);
        $challenge = $challenges[$key] ?? null;
        unset($challenges[$key]);
        $request->session()->set(self::SESSION_KEY, $challenges);
        if (!is_array($challenge)) {
            throw new ApiException('验证码已失效，请重新验证。', 422, 'captcha_expired');
        }

        try {
            $this->service((string) $challenge['type'])->verificationByEncryptCode($verification);
        } catch (\Throwable $error) {
            throw new ApiException('验证码已失效，请重新验证。', 422, 'captcha_expired');
        }
    }

    private function service(string $type): WikistBlockPuzzleCaptchaService|WikistClickWordCaptchaService
    {
        $config = require base_path('vendor/fastknife/ajcaptcha/src/config.php');
        $siteName = trim((string) (new SiteConfigRepository())->get('name', config('wikist.name')));
        $config['watermark'] = [
            'fontsize' => 11,
            'color' => '#ffffff',
            'text' => $siteName !== '' ? $siteName : 'Wikist',
        ];
        $config['cache']['options'] = array_merge($config['cache']['options'] ?? [], [
            'expire' => self::TTL,
            'prefix' => 'passport-captcha',
            'path' => runtime_path() . DIRECTORY_SEPARATOR . 'captcha',
        ]);
        $config['block_puzzle'] = array_merge($config['block_puzzle'] ?? [], [
            'mode' => 'drawing',
            'shape_type' => 'jigsaw',
            'offset' => 6,
        ]);
        $config['click_word'] = array_merge($config['click_word'] ?? [], [
            'word_num' => 3,
            'distract_num' => 2,
            'icon_mode' => 'random',
            'max_icons' => 1,
        ]);

        return $type === 'clickWord'
            ? new WikistClickWordCaptchaService($config)
            : new WikistBlockPuzzleCaptchaService($config);
    }

    private function normalizeType(string $type): string
    {
        return match (strtolower(trim($type))) {
            'clickword', 'click_word', 'word', 'wordclick' => 'clickWord',
            'blockpuzzle', 'block_puzzle', 'slider', 'slide', '' => 'blockPuzzle',
            default => throw new ApiException('不支持的验证码类型。', 422, 'captcha_type_invalid'),
        };
    }

    private function normalizePoint(string $type, mixed $point): array
    {
        if (is_string($point)) {
            $decoded = json_decode($point, true);
            $point = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($point)) {
            throw new ApiException('验证码坐标无效。', 422, 'captcha_point_invalid');
        }
        if ($type === 'blockPuzzle') {
            $x = filter_var($point['x'] ?? null, FILTER_VALIDATE_FLOAT);
            if ($x === false || $x < 0 || $x > 263) {
                throw new ApiException('验证码坐标无效。', 422, 'captcha_point_invalid');
            }
            return ['x' => (int) round($x), 'y' => 5];
        }

        if (count($point) < 2 || count($point) > 5) {
            throw new ApiException('请按顺序点选完整的验证码。', 422, 'captcha_point_invalid');
        }
        return array_map(static function (mixed $item): array {
            if (!is_array($item)) {
                throw new ApiException('验证码坐标无效。', 422, 'captcha_point_invalid');
            }
            $x = filter_var($item['x'] ?? null, FILTER_VALIDATE_FLOAT);
            $y = filter_var($item['y'] ?? null, FILTER_VALIDATE_FLOAT);
            if ($x === false || $y === false || $x < 0 || $x > 310 || $y < 0 || $y > 155) {
                throw new ApiException('验证码坐标无效。', 422, 'captcha_point_invalid');
            }
            return ['x' => (int) round($x), 'y' => (int) round($y)];
        }, array_values($point));
    }

    private function activeChallenges(array $challenges): array
    {
        return array_filter($challenges, static fn (mixed $challenge): bool =>
            is_array($challenge) && (int) ($challenge['expires_at'] ?? 0) >= time()
        );
    }

    private function verificationKey(string $verification): string
    {
        return hash_hmac('sha256', $verification, (string) config('wikist.secret'));
    }

    private function tokenKey(string $token): string
    {
        return hash_hmac('sha256', 'issued:' . $token, (string) config('wikist.secret'));
    }

    private function imageSize(string $base64): array
    {
        $binary = base64_decode($base64, true);
        if (!is_string($binary) || $binary === '') {
            return [null, null];
        }
        $size = @getimagesizefromstring($binary);
        return is_array($size) ? [(int) $size[0], (int) $size[1]] : [null, null];
    }
}

final class WikistBlockPuzzleCaptchaService extends BlockPuzzleCaptchaService
{
    public function checkPlain(string $token, array $point): ?string
    {
        $this->setOriginData($token);
        $encrypted = AesUtils::encrypt(json_encode($point, JSON_THROW_ON_ERROR), (string) $this->originData['secretKey']);
        return $this->check($token, $encrypted);
    }
}

final class WikistClickWordCaptchaService extends ClickWordCaptchaService
{
    private const HIT_TOLERANCE = 24;

    public function checkPlain(string $token, array $point): ?string
    {
        $this->setOriginData($token);
        $encrypted = AesUtils::encrypt(json_encode($point, JSON_THROW_ON_ERROR), (string) $this->originData['secretKey']);
        return $this->check($token, $encrypted);
    }

    public function validate($token, $pointJson)
    {
        $this->setOriginData($token);
        $points = $this->decodePoint((string) $this->originData['secretKey'], $pointJson);
        $targets = is_array($this->originData['point'] ?? null) ? $this->originData['point'] : [];
        if (!is_array($points) || count($points) !== count($targets)) {
            throw new WordException('验证码点选数量不匹配。');
        }

        foreach ($targets as $index => $target) {
            $point = $points[$index] ?? null;
            if (!is_array($point) || !isset($point['x'], $point['y'])) {
                throw new WordException('验证码点选坐标无效。');
            }
            // Fastknife draws each glyph from its left edge around a vertical center anchor.
            $centerX = (float) $target->x + 12.5;
            $centerY = (float) $target->y;
            if (abs((float) $point['x'] - $centerX) > self::HIT_TOLERANCE
                || abs((float) $point['y'] - $centerY) > self::HIT_TOLERANCE) {
                throw new WordException('验证码点选位置不正确。');
            }
        }
    }
}
