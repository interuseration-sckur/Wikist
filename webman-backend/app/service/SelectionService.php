<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\SelectionRepository;

final class SelectionService
{
    private const OBJECT_TYPES = [
        'wiki_entry', 'article', 'question', 'answer', 'organization',
        'organization_post', 'organization_reply', 'translation', 'user_page',
    ];

    public function __construct(private readonly SelectionRepository $selections = new SelectionRepository())
    {
    }

    public function resolve(?UserIdentity $identity, array $input, int $commentPage = 1): array
    {
        $anchor = $this->anchor($input);
        $row = $identity && (bool) ($input['create'] ?? false)
            ? $this->selections->createOrRefresh($anchor, $identity->id)
            : $this->selections->findByAnchor($anchor['objectType'], $anchor['objectId'], $anchor['anchorHash']);
        if (!$row) {
            return [
                'selection' => null,
                'comments' => ['items' => [], 'pagination' => $this->emptyPagination()],
            ];
        }
        $id = (int) $row->id;
        return [
            'selection' => $this->selections->selection($id, $identity?->id ?? 0),
            'comments' => $this->selections->comments($id, $commentPage, 20),
        ];
    }

    public function detail(?UserIdentity $identity, int $selectionId): array
    {
        $selection = $this->requireSelection($selectionId, $identity?->id ?? 0);
        return ['selection' => $selection];
    }

    public function comments(int $selectionId, int $page, int $limit): array
    {
        $selection = $this->requireSelection($selectionId);
        return $this->selections->comments((int) $selection['id'], $page, $limit);
    }

    public function markers(?UserIdentity $identity, string $objectType, string $objectId): array
    {
        $objectType = mb_strtolower(trim($objectType));
        if (!in_array($objectType, self::OBJECT_TYPES, true)) {
            throw new ApiException('该正文类型暂不支持划词。', 422, 'selection_object_type_invalid');
        }
        $objectId = $this->identifier($objectId, 190, '正文标识');
        return ['items' => $this->selections->markers($objectType, $objectId, $identity?->id ?? 0)];
    }

    public function addComment(UserIdentity $identity, int $selectionId, array $input): array
    {
        $selection = $this->requireSelection($selectionId, $identity->id);
        $selectionId = (int) $selection['id'];
        $body = $this->plainText((string) ($input['bodyMd'] ?? $input['body'] ?? ''), 4000);
        if ($body === '') {
            throw new ApiException('请输入批注内容。', 422, 'selection_comment_empty');
        }
        $replyToCommentId = max(0, (int) ($input['replyToCommentId'] ?? 0));
        if ($replyToCommentId > 0) {
            $reply = $this->selections->comment($replyToCommentId);
            if (!$reply || (int) $reply->selection_id !== $selectionId) {
                throw new ApiException('回复的批注不存在或不属于当前划词。', 422, 'selection_reply_invalid');
            }
        }
        return ['comment' => $this->selections->addComment(
            $selectionId,
            $identity->id,
            $body,
            $body,
            $replyToCommentId,
        )];
    }

    public function deleteComment(UserIdentity $identity, int $selectionId, int $commentId): array
    {
        $selection = $this->requireSelection($selectionId, $identity->id);
        $selectionId = (int) $selection['id'];
        $comment = $this->selections->comment($commentId);
        if (!$comment || (int) $comment->selection_id !== $selectionId) {
            throw new ApiException('批注不存在。', 404, 'selection_comment_not_found');
        }
        if ((int) $comment->user_id !== $identity->id && $identity->role !== 'admin') {
            throw new ApiException('只能删除自己的批注。', 403, 'selection_comment_forbidden');
        }
        $this->selections->deleteComment($commentId);
        return ['deleted' => true, 'commentId' => $commentId];
    }

    public function setLike(UserIdentity $identity, int $selectionId, array $input): array
    {
        $selection = $this->requireSelection($selectionId, $identity->id);
        $selectionId = (int) $selection['id'];
        return $this->selections->setLike($selectionId, $identity->id, (bool) ($input['liked'] ?? $input['enabled'] ?? true));
    }

    public function deleteSelection(UserIdentity $identity, int $selectionId): array
    {
        $selection = $this->requireSelection($selectionId, $identity->id);
        $selectionId = (int) $selection['id'];
        if (!(bool) ($selection['canDelete'] ?? false)) {
            throw new ApiException('只能删除自己创建的划词。', 403, 'selection_delete_forbidden');
        }
        $result = $this->selections->deleteOwned($selectionId, $identity->id);
        if (!(bool) ($result['deleted'] ?? false)) {
            throw new ApiException('划词记录不存在或已删除。', 404, 'selection_not_found');
        }
        return ['selectionId' => $selectionId] + $result;
    }

    public function recordActivity(UserIdentity $identity, int $selectionId, array $input): array
    {
        $selection = $this->requireSelection($selectionId, $identity->id);
        $selectionId = (int) $selection['id'];
        $activityType = mb_strtolower(trim((string) ($input['activityType'] ?? $input['type'] ?? 'quote')));
        if ($activityType !== 'quote') {
            throw new ApiException('不支持该划词记录类型。', 422, 'selection_activity_invalid');
        }
        $targetType = mb_strtolower(trim((string) ($input['targetType'] ?? '')));
        if (!in_array($targetType, ['comment', 'post', 'chat', 'answer'], true)) {
            throw new ApiException('请选择引用去向。', 422, 'selection_target_invalid');
        }
        $targetId = trim(str_replace(["\0", "\r", "\n"], '', (string) ($input['targetId'] ?? '')));
        $targetLabel = $this->plainText((string) ($input['targetLabel'] ?? ''), 255);
        $metadata = is_array($input['metadata'] ?? null) ? $input['metadata'] : [];
        return ['activity' => $this->selections->recordActivity($selectionId, $identity->id, [
            'activityType' => $activityType,
            'targetType' => $targetType,
            'targetId' => mb_substr($targetId, 0, 190),
            'targetLabel' => $targetLabel,
            'metadata' => array_slice($metadata, 0, 12, true),
        ])];
    }

    public function mine(UserIdentity $identity, string $mode, int $page, int $limit): array
    {
        $mode = in_array($mode, ['all', 'liked', 'commented'], true) ? $mode : 'all';
        return $this->selections->mine($identity->id, $mode, $page, $limit);
    }

    private function requireSelection(int $selectionId, int $viewerId = 0): array
    {
        if ($selectionId <= 0) {
            throw new ApiException('划词记录不存在。', 404, 'selection_not_found');
        }
        $selection = $this->selections->selection($selectionId, $viewerId);
        if (!$selection) {
            throw new ApiException('划词记录不存在。', 404, 'selection_not_found');
        }
        return $selection;
    }

    private function anchor(array $input): array
    {
        $object = is_array($input['object'] ?? null) ? $input['object'] : $input;
        $selector = is_array($input['selector'] ?? null) ? $input['selector'] : $input;
        $objectType = mb_strtolower(trim((string) ($object['type'] ?? $object['objectType'] ?? '')));
        if (!in_array($objectType, self::OBJECT_TYPES, true)) {
            throw new ApiException('该正文类型暂不支持划词。', 422, 'selection_object_type_invalid');
        }
        $objectId = $this->identifier((string) ($object['id'] ?? $object['objectId'] ?? ''), 190, '正文标识');
        $selectedText = $this->plainText((string) ($selector['exact'] ?? $selector['selectedText'] ?? ''), 5000);
        if ($selectedText === '') {
            throw new ApiException('请先选择正文内容。', 422, 'selection_text_empty');
        }
        $prefixText = $this->plainText((string) ($selector['prefix'] ?? $selector['prefixText'] ?? ''), 500);
        $suffixText = $this->plainText((string) ($selector['suffix'] ?? $selector['suffixText'] ?? ''), 500);
        $startOffset = max(0, min(100000000, (int) ($selector['start'] ?? $selector['startOffset'] ?? 0)));
        $endOffset = max($startOffset, min(100000000, (int) ($selector['end'] ?? $selector['endOffset'] ?? ($startOffset + mb_strlen($selectedText)))));
        $objectLabel = $this->plainText((string) ($object['label'] ?? $object['objectLabel'] ?? $objectId), 255);
        $objectUrl = trim((string) ($object['url'] ?? $object['objectUrl'] ?? ''));
        if ($objectUrl !== '' && !str_starts_with($objectUrl, '#/')) {
            $objectUrl = '';
        }
        $objectUrl = mb_substr($objectUrl, 0, 1024);
        $anchorHash = hash('sha256', implode("\0", [$objectType, $objectId, $selectedText, $prefixText, $suffixText]));
        return compact(
            'objectType', 'objectId', 'objectLabel', 'objectUrl', 'selectedText',
            'prefixText', 'suffixText', 'startOffset', 'endOffset', 'anchorHash',
        );
    }

    private function identifier(string $value, int $limit, string $label): string
    {
        $value = trim(str_replace(["\0", "\r", "\n"], '', $value));
        if ($value === '' || mb_strlen($value) > $limit) {
            throw new ApiException($label . '无效。', 422, 'selection_object_id_invalid');
        }
        return $value;
    }

    private function plainText(string $value, int $limit): string
    {
        $value = trim(str_replace("\0", '', str_replace(["\r\n", "\r"], "\n", $value)));
        return mb_substr($value, 0, $limit);
    }

    private function emptyPagination(): array
    {
        return ['page' => 1, 'pageSize' => 20, 'total' => 0, 'totalPages' => 1, 'hasPrev' => false, 'hasNext' => false];
    }
}
