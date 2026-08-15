<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\MessagingRepository;
use Webman\Http\UploadFile;

final class MessagingAttachmentService
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
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
    ];

    public function __construct(
        private readonly MessagingRepository $messages = new MessagingRepository(),
        private readonly MessagingPermissionService $permissions = new MessagingPermissionService(),
    ) {
    }

    public function store(UserIdentity $identity, ?UploadFile $upload): array
    {
        if (!$upload || !$upload->isValid()) {
            throw new ApiException('请选择有效的附件。', 422, 'invalid_attachment');
        }
        $source = $upload->getPathname();
        $size = (int) filesize($source);
        $max = max(1024 * 1024, (int) config('wikist.messaging.attachment_max_bytes', 10 * 1024 * 1024));
        if ($size <= 0 || $size > $max) {
            throw new ApiException('附件大小超出限制。', 422, 'attachment_too_large', ['maxBytes' => $max]);
        }
        $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($source);
        $extension = self::MIME_EXTENSIONS[$mime] ?? null;
        if (!$extension) {
            throw new ApiException('不支持该附件类型。', 422, 'attachment_type_not_allowed', ['mimeType' => $mime]);
        }
        $publicId = $this->messages->newPublicId('att');
        $relative = gmdate('Y/m') . '/' . $publicId . '.' . $extension;
        $root = $this->storageRoot();
        $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        $directory = dirname($target);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new \RuntimeException('无法创建消息附件目录。');
        }
        $sha256 = hash_file('sha256', $source);
        $width = null;
        $height = null;
        if (str_starts_with($mime, 'image/')) {
            $dimensions = @getimagesize($source);
            if (is_array($dimensions)) {
                $width = (int) $dimensions[0];
                $height = (int) $dimensions[1];
            }
        }
        $name = mb_substr(basename((string) ($upload->getUploadName() ?: 'attachment.' . $extension)), 0, 240);
        try {
            $upload->move($target);
            @chmod($target, 0640);
            $row = $this->messages->createAttachment([
                'publicId' => $publicId,
                'ownerUserId' => $identity->id,
                'storagePath' => $relative,
                'originalName' => $name,
                'mimeType' => $mime,
                'sizeBytes' => $size,
                'sha256' => $sha256,
                'width' => $width,
                'height' => $height,
            ]);
        } catch (\Throwable $error) {
            if (is_file($target)) {
                @unlink($target);
            }
            throw $error;
        }
        return [
            'id' => (string) $row->public_id,
            'name' => (string) $row->original_name,
            'mimeType' => (string) $row->mime_type,
            'size' => (int) $row->size_bytes,
            'width' => $row->width !== null ? (int) $row->width : null,
            'height' => $row->height !== null ? (int) $row->height : null,
            'url' => '/api/messaging/attachments/' . rawurlencode((string) $row->public_id),
            'status' => 'pending',
        ];
    }

    /** @return array{path:string,name:string,mimeType:string} */
    public function authorize(UserIdentity $identity, string $publicId): array
    {
        $attachment = $this->messages->attachment($publicId);
        if (!$attachment) {
            throw new ApiException('附件不存在。', 404, 'attachment_not_found');
        }
        if ($attachment->message_id === null) {
            if ((int) $attachment->owner_user_id !== $identity->id) {
                throw new ApiException('你无权访问该附件。', 403, 'attachment_access_denied');
            }
        } else {
            $message = $this->messages->messageById((int) $attachment->message_id);
            if (!$message) {
                throw new ApiException('附件所属消息不存在。', 404, 'attachment_message_not_found');
            }
            $conversation = $this->messages->connection()->table('messaging_conversations')
                ->where('id', $message->conversation_id)->first();
            if (!$conversation) {
                throw new ApiException('附件所属会话不存在。', 404, 'conversation_not_found');
            }
            $this->permissions->assertConversationAccess($identity, $conversation);
        }
        $root = $this->storageRoot();
        $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $attachment->storage_path);
        $rootReal = realpath($root);
        $pathReal = realpath($path);
        if (!$rootReal || !$pathReal || !str_starts_with($pathReal, $rootReal . DIRECTORY_SEPARATOR) || !is_file($pathReal)) {
            throw new ApiException('附件文件不可用。', 404, 'attachment_file_missing');
        }
        return ['path' => $pathReal, 'name' => (string) $attachment->original_name, 'mimeType' => (string) $attachment->mime_type];
    }

    private function storageRoot(): string
    {
        $configured = trim((string) config('wikist.messaging.attachment_root', ''));
        if ($configured === '') {
            return dirname(base_path()) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'messaging';
        }
        $absolute = preg_match('~^(?:[A-Za-z]:[\\\\/]|[/\\\\]{1,2})~', $configured) === 1;
        return rtrim($absolute ? $configured : base_path() . DIRECTORY_SEPARATOR . $configured, '/\\');
    }
}
