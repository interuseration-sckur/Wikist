<?php

namespace app\service;

use app\exception\ApiException;
use BaconQrCode\Common\ErrorCorrectionLevel;
use BaconQrCode\Renderer\GDLibRenderer;
use BaconQrCode\Writer;

final class QrCodeService
{
    public function dataUri(string $payload): string
    {
        if ($payload === '' || strlen($payload) > 2048) {
            throw new ApiException('二维码内容无效。', 500, 'qr_payload_invalid');
        }

        try {
            $png = (new Writer(new GDLibRenderer(240, 16)))->writeString(
                $payload,
                'UTF-8',
                ErrorCorrectionLevel::M(),
            );
        } catch (\Throwable $error) {
            throw new ApiException('二次验证二维码生成失败，请稍后重试。', 503, 'qr_generation_failed');
        }

        if (!str_starts_with($png, "\x89PNG\r\n\x1a\n")) {
            throw new ApiException('二次验证二维码生成失败，请稍后重试。', 503, 'qr_generation_failed');
        }
        return 'data:image/png;base64,' . base64_encode($png);
    }
}
