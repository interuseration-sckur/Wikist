<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\CommunityRepository;
use Webman\Http\UploadFile;

final class CommunityAttachmentService
{
    private const MIME_EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'image/avif' => 'avif',
        'application/pdf' => 'pdf',
        'text/plain' => 'txt',
        'text/markdown' => 'md',
        'application/zip' => 'zip',
        'application/x-zip-compressed' => 'zip',
    ];

    public function __construct(
        private readonly CommunityRepository $community = new CommunityRepository(),
        private readonly CommunityPermissionService $permissions = new CommunityPermissionService(),
    ) {
    }

    public function store(UserIdentity $identity, ?UploadFile $upload): array
    {
        $this->permissions->assertActive($identity);
        if (!$upload || !$upload->isValid()) {
            throw new ApiException('请选择有效的附件。', 422, 'community_attachment_invalid');
        }
        $source = $upload->getPathname();
        $size = is_file($source) ? (int) filesize($source) : 0;
        $max = max(1024 * 1024, (int) config('wikist.community.attachment_max_bytes', 12 * 1024 * 1024));
        if ($size <= 0 || $size > $max) {
            throw new ApiException('附件大小超出限制。', 422, 'community_attachment_too_large', ['maxBytes' => $max]);
        }
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($source);
        $extension = self::MIME_EXTENSIONS[$mime] ?? null;
        if (!$extension) {
            throw new ApiException('不支持该附件类型。', 422, 'community_attachment_type_not_allowed', ['mimeType' => $mime]);
        }
        $publicId = 'catt_' . bin2hex(random_bytes(12));
        $relative = gmdate('Y/m') . '/' . $publicId . '.' . $extension;
        $root = $this->storageRoot();
        $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        $directory = dirname($target);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new \RuntimeException('无法创建社区附件目录。');
        }
        $metadata = [];
        if (str_starts_with($mime, 'image/')) {
            $dimensions = @getimagesize($source);
            if (is_array($dimensions)) {
                $metadata = ['width' => (int) $dimensions[0], 'height' => (int) $dimensions[1]];
            }
        }
        $name = mb_substr(basename((string) ($upload->getUploadName() ?: 'attachment.' . $extension)), 0, 240);
        try {
            $upload->move($target);
            @chmod($target, 0640);
            $row = $this->community->createAttachment([
                'publicId' => $publicId,
                'ownerUserId' => $identity->id,
                'storagePath' => $relative,
                'originalName' => $name,
                'mimeType' => $mime,
                'sizeBytes' => $size,
                'sha256' => hash_file('sha256', $target),
                'metadata' => $metadata,
            ]);
        } catch (\Throwable $error) {
            if (is_file($target)) {
                @unlink($target);
            }
            throw $error;
        }
        return $this->data($row);
    }

    public function bind(UserIdentity $identity, array $ids, string $objectType, int $objectId): void
    {
        $ids = array_values(array_unique(array_filter(array_map(static fn (mixed $id): string => trim((string) $id), $ids))));
        if (count($ids) > 10) {
            throw new ApiException('单次最多绑定 10 个附件。', 422, 'community_attachment_limit');
        }
        try {
            $this->community->bindAttachments($identity->id, $ids, $objectType, $objectId);
        } catch (\RuntimeException $error) {
            throw new ApiException($error->getMessage(), 403, 'community_attachment_bind_denied');
        }
    }

    /** @return array{path:string,name:string,mimeType:string} */
    public function authorize(?UserIdentity $identity, string $publicId): array
    {
        $attachment = $this->community->attachment($publicId);
        if (!$attachment) {
            throw new ApiException('附件不存在。', 404, 'community_attachment_not_found');
        }
        if ((string) $attachment->status === 'pending') {
            if (!$identity || (int) $attachment->owner_user_id !== $identity->id) {
                throw new ApiException('你无权访问该附件。', 403, 'community_attachment_access_denied');
            }
        } elseif ((string) $attachment->status !== 'ready') {
            throw new ApiException('附件不可用。', 404, 'community_attachment_not_found');
        } else {
            $question = match ((string) $attachment->object_type) {
                'question' => $this->community->questionRaw((int) $attachment->object_id),
                'answer' => ($answer = $this->community->answer((int) $attachment->object_id))
                    ? $this->community->questionRaw((int) $answer->question_id) : null,
                'comment' => ($comment = $this->community->comment((int) $attachment->object_id))
                    ? $this->community->questionRaw((int) $comment->question_id) : null,
                default => null,
            };
            if (!$question) {
                throw new ApiException('附件所属内容不存在。', 404, 'community_attachment_parent_missing');
            }
            $this->permissions->assertQuestionReadable($question, $identity);
        }
        $root = $this->storageRoot();
        $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $attachment->storage_path);
        $rootReal = realpath($root);
        $pathReal = realpath($path);
        if (!$rootReal || !$pathReal || !str_starts_with($pathReal, $rootReal . DIRECTORY_SEPARATOR) || !is_file($pathReal)) {
            throw new ApiException('附件文件不可用。', 404, 'community_attachment_file_missing');
        }
        return ['path' => $pathReal, 'name' => (string) $attachment->original_name, 'mimeType' => (string) $attachment->mime_type];
    }

    public function data(object $row): array
    {
        $metadata = json_decode((string) $row->metadata_json, true);
        return [
            'id' => (string) $row->public_id,
            'name' => (string) $row->original_name,
            'mimeType' => (string) $row->mime_type,
            'size' => (int) $row->size_bytes,
            'width' => is_array($metadata) ? ($metadata['width'] ?? null) : null,
            'height' => is_array($metadata) ? ($metadata['height'] ?? null) : null,
            'url' => '/api/community/qa/attachments/' . rawurlencode((string) $row->public_id),
            'status' => (string) $row->status,
        ];
    }

    private function storageRoot(): string
    {
        $configured = trim((string) config('wikist.community.attachment_root', ''));
        if ($configured === '') {
            return dirname(base_path()) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'community';
        }
        $absolute = preg_match('~^(?:[A-Za-z]:[\\\\/]|[/\\\\]{1,2})~', $configured) === 1;
        return rtrim($absolute ? $configured : base_path() . DIRECTORY_SEPARATOR . $configured, '/\\');
    }
}
