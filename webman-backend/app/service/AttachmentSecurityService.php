<?php

namespace app\service;

use app\exception\ApiException;
use support\Db;

final class AttachmentSecurityService
{
    private const ATTACHMENT_TABLES = ['messaging_attachments', 'community_attachments'];

    private const MAX_IMAGE_EDGE = 16000;
    private const MAX_IMAGE_PIXELS = 40000000;
    private const MAX_ARCHIVE_FILES = 5000;
    private const MAX_ARCHIVE_EXPANDED_BYTES = 160000000;

    public function inspect(string $source, string $mime, int $size): array
    {
        if (!is_file($source) || is_link($source)) {
            throw new ApiException('附件文件不可用。', 422, 'attachment_file_invalid');
        }
        $metadata = [];
        if (str_starts_with($mime, 'image/')) {
            $dimensions = @getimagesize($source);
            if (!is_array($dimensions) || empty($dimensions[0]) || empty($dimensions[1])) {
                throw new ApiException('图片内容无法识别。', 422, 'attachment_image_invalid');
            }
            $width = (int) $dimensions[0];
            $height = (int) $dimensions[1];
            if ($width > self::MAX_IMAGE_EDGE || $height > self::MAX_IMAGE_EDGE || $width * $height > self::MAX_IMAGE_PIXELS) {
                throw new ApiException('图片像素尺寸超出安全限制。', 422, 'attachment_image_dimensions');
            }
            $metadata = ['width' => $width, 'height' => $height];
        }
        if (in_array($mime, [
            'application/zip',
            'application/x-zip-compressed',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ], true)) {
            $this->inspectZip($source, $size);
        }
        return $metadata;
    }

    public function assertStorageCapacity(string $root, int $incomingBytes): void
    {
        $probe = is_dir($root) ? $root : dirname($root);
        while (!is_dir($probe) && dirname($probe) !== $probe) {
            $probe = dirname($probe);
        }
        $free = @disk_free_space($probe);
        $reserve = max(128 * 1024 * 1024, $incomingBytes * 3);
        if ($free !== false && $free < $reserve) {
            throw new ApiException('附件存储空间不足。', 507, 'attachment_storage_full');
        }
    }

    public function enforceUserQuota(int $userId, int $incomingBytes): void
    {
        $connection = Db::connection((string) config('wikist.passport.connection', 'wikist'));
        $schema = $connection->getSchemaBuilder();
        $total = 0;
        $pendingBytes = 0;
        $pendingCount = 0;
        foreach (self::ATTACHMENT_TABLES as $table) {
            if (!$schema->hasTable($table)) {
                continue;
            }
            $query = $connection->table($table)->where('owner_user_id', $userId);
            $total += (int) (clone $query)->sum('size_bytes');
            $pending = (clone $query)->where('status', 'pending');
            $pendingBytes += (int) (clone $pending)->sum('size_bytes');
            $pendingCount += (int) (clone $pending)->count();
        }
        $quota = max(16 * 1024 * 1024, (int) config('wikist.attachments.user_quota_bytes', 512 * 1024 * 1024));
        $pendingQuota = max(4 * 1024 * 1024, (int) config('wikist.attachments.pending_quota_bytes', 64 * 1024 * 1024));
        $pendingLimit = max(1, (int) config('wikist.attachments.pending_count_limit', 25));
        if ($total + $incomingBytes > $quota) {
            throw new ApiException('附件存储配额已满，请清理不再需要的附件。', 422, 'attachment_user_quota_exceeded', ['quotaBytes' => $quota]);
        }
        if ($pendingCount >= $pendingLimit || $pendingBytes + $incomingBytes > $pendingQuota) {
            throw new ApiException('待发送附件过多，请先完成发送或稍后重试。', 422, 'attachment_pending_quota_exceeded', [
                'maxPending' => $pendingLimit,
                'pendingQuotaBytes' => $pendingQuota,
            ]);
        }
    }

    public function purgeExpiredPending(string $table, string $storageRoot): int
    {
        if (!in_array($table, self::ATTACHMENT_TABLES, true)) {
            throw new \InvalidArgumentException('Unknown attachment table.');
        }
        $connection = Db::connection((string) config('wikist.passport.connection', 'wikist'));
        if (!$connection->getSchemaBuilder()->hasTable($table)) {
            return 0;
        }
        $ttl = max(3600, (int) config('wikist.attachments.pending_ttl_seconds', 86400));
        $cutoff = gmdate('c', time() - $ttl);
        $rows = $connection->table($table)->select(['id', 'storage_path'])
            ->where('status', 'pending')->where('created_at', '<', $cutoff)->limit(200)->get()->all();
        $removed = 0;
        foreach ($rows as $row) {
            $deleted = $connection->table($table)->where('id', (int) $row->id)
                ->where('status', 'pending')->where('created_at', '<', $cutoff)->delete();
            if ($deleted !== 1) {
                continue;
            }
            $this->removeStoredFile($storageRoot, (string) $row->storage_path);
            $removed++;
        }
        return $removed;
    }

    private function removeStoredFile(string $root, string $relative): void
    {
        $relative = str_replace('\\', '/', trim($relative));
        if ($relative === '' || str_starts_with($relative, '/') || str_contains($relative, "\0") || in_array('..', explode('/', $relative), true)) {
            return;
        }
        $rootReal = realpath($root);
        $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        $targetReal = realpath($target);
        if ($rootReal && $targetReal && str_starts_with($targetReal, $rootReal . DIRECTORY_SEPARATOR) && is_file($targetReal) && !is_link($targetReal)) {
            @unlink($targetReal);
        }
    }

    public function contentDisposition(string $name, bool $inline): string
    {
        $clean = str_replace(["\r", "\n", '"', '\\'], '', basename($name));
        $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', $clean) ?: 'attachment';
        return ($inline ? 'inline' : 'attachment')
            . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($clean);
    }

    private function inspectZip(string $source, int $compressedBytes): void
    {
        if (!class_exists(\ZipArchive::class)) {
            return;
        }
        $zip = new \ZipArchive();
        if ($zip->open($source, \ZipArchive::RDONLY) !== true) {
            throw new ApiException('压缩附件无法识别。', 422, 'attachment_archive_invalid');
        }
        try {
            if ($zip->numFiles > self::MAX_ARCHIVE_FILES) {
                throw new ApiException('压缩附件包含过多文件。', 422, 'attachment_archive_file_limit');
            }
            $expanded = 0;
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index);
                $name = str_replace('\\', '/', (string) ($stat['name'] ?? ''));
                if ($name === '' || str_starts_with($name, '/') || preg_match('~(^|/)\.\.(/|$)~', $name)) {
                    throw new ApiException('压缩附件包含不安全路径。', 422, 'attachment_archive_path');
                }
                $expanded += max(0, (int) ($stat['size'] ?? 0));
                if ($expanded > self::MAX_ARCHIVE_EXPANDED_BYTES || ($compressedBytes > 0 && $expanded > $compressedBytes * 120)) {
                    throw new ApiException('压缩附件展开体积超出安全限制。', 422, 'attachment_archive_expansion');
                }
            }
        } finally {
            $zip->close();
        }
    }
}
