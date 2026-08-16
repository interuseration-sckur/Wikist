<?php

namespace app\controller;

use app\http\ApiResponse;
use app\service\CommunityQaService;
use app\service\CommunityAttachmentService;
use app\service\AttachmentSecurityService;
use support\Request;
use support\Response;

final class CommunityQaController
{
    public function bootstrap(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->bootstrap($request->identity ?? null));
    }

    public function index(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->questions([
            'page' => (int) $request->get('page', 1),
            'limit' => (int) $request->get('limit', 12),
            'query' => (string) $request->get('q', ''),
            'order' => (string) $request->get('order', 'active'),
            'tag' => (string) $request->get('tag', ''),
            'organization' => (string) $request->get('organization', ''),
            'origin' => (string) $request->get('origin', ''),
        ], $request->identity ?? null));
    }

    public function search(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->search([
            'page' => (int) $request->get('page', 1),
            'limit' => (int) $request->get('limit', 12),
            'query' => (string) $request->get('q', ''),
        ], $request->identity ?? null));
    }

    public function show(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->question(
            $id,
            $request->identity ?? null,
            (int) $request->get('answerPage', 1),
            $this->viewerKey($request),
        ));
    }

    public function comments(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->comments(
            $type,
            $id,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 12),
            $request->identity ?? null,
        ));
    }

    public function tags(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->tags(
            (string) $request->get('q', ''),
            (int) $request->get('page', 1),
            (int) $request->get('limit', 24),
            $request->identity ?? null,
        ));
    }

    public function activity(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->activity([
            'page' => (int) $request->get('page', 1),
            'limit' => (int) $request->get('limit', 20),
            'userId' => (int) $request->get('userId', 0),
        ], $request->identity ?? null));
    }

    public function revisions(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->revisions(
            $type,
            $id,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
            $request->identity ?? null,
        ));
    }

    public function revisionDiff(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->revisionDiff(
            $type,
            $id,
            (string) $request->get('from', ''),
            (string) $request->get('to', ''),
            $request->identity ?? null,
        ));
    }

    public function reputation(Request $request, string $userId): Response
    {
        return ApiResponse::data((new CommunityQaService())->reputation(
            (int) $userId,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
            $request->identity ?? null,
        ));
    }

    public function badges(Request $request, string $userId): Response
    {
        return ApiResponse::data((new CommunityQaService())->badges((int) $userId));
    }

    public function related(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->related(
            (string) $request->get('type', 'wiki_entry'),
            (string) $request->get('id', ''),
            (int) $request->get('page', 1),
            (int) $request->get('limit', 8),
            $request->identity ?? null,
        ));
    }

    public function objectPreview(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->objectPreview(
            (string) $request->get('type', ''),
            (string) $request->get('id', ''),
            $request->identity ?? null,
        ));
    }

    public function create(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->createQuestion(
            $request->identity,
            $this->input($request),
        ), 201);
    }

    public function updateQuestion(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->updateQuestion(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function proposeRevision(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->proposeQuestionRevision(
            $request->identity,
            $id,
            $this->input($request),
        ), 201);
    }

    public function deleteQuestion(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->deleteQuestion($request->identity, $id));
    }

    public function closeQuestion(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->setQuestionOpen(
            $request->identity,
            $id,
            false,
            (string) ($this->input($request)['reason'] ?? ''),
        ));
    }

    public function reopenQuestion(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->setQuestionOpen($request->identity, $id, true));
    }

    public function inviteAnswer(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->inviteAnswer(
            $request->identity,
            $id,
            $this->input($request),
        ), 201);
    }

    public function respondAnswerInvite(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->respondAnswerInvite(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function answer(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->createAnswer(
            $request->identity,
            $id,
            $this->input($request),
        ), 201);
    }

    public function updateAnswer(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->updateAnswer(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function deleteAnswer(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->deleteAnswer($request->identity, $id));
    }

    public function acceptAnswer(Request $request, string $questionId, string $answerId): Response
    {
        return ApiResponse::data((new CommunityQaService())->acceptAnswer($request->identity, $questionId, $answerId));
    }

    public function unacceptAnswer(Request $request, string $questionId, string $answerId): Response
    {
        return ApiResponse::data((new CommunityQaService())->unacceptAnswer($request->identity, $questionId, $answerId));
    }

    public function comment(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->createComment(
            $request->identity,
            $id,
            $this->input($request),
        ), 201);
    }

    public function updateComment(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->updateComment(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function deleteComment(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->deleteComment($request->identity, $id));
    }

    public function vote(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->vote(
            $request->identity,
            $type,
            $id,
            (int) ($this->input($request)['value'] ?? 0),
        ));
    }

    public function reaction(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->reaction(
            $request->identity,
            $type,
            $id,
            (string) ($this->input($request)['reaction'] ?? ''),
        ));
    }

    public function collection(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->collection(
            $request->identity,
            $type,
            $id,
            $this->input($request),
        ));
    }

    public function collections(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->collections(
            $request->identity,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
        ));
    }

    public function follows(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->follows(
            $request->identity,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
        ));
    }

    public function follow(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->follow(
            $request->identity,
            $type,
            $id,
            $this->input($request),
        ));
    }

    public function report(Request $request, string $type, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->report(
            $request->identity,
            $type,
            $id,
            $this->input($request),
        ), 201);
    }

    public function reports(Request $request): Response
    {
        $organizationId = (int) $request->get('organizationId', 0);
        return ApiResponse::data((new CommunityQaService())->reports(
            $request->identity,
            (string) $request->get('status', 'pending'),
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
            $organizationId > 0 ? $organizationId : null,
        ));
    }

    public function moderationOverview(Request $request): Response
    {
        return ApiResponse::data((new CommunityQaService())->moderationOverview($request->identity));
    }

    public function resolveReport(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->resolveReport(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function reviews(Request $request): Response
    {
        $organizationId = (int) $request->get('organizationId', 0);
        return ApiResponse::data((new CommunityQaService())->reviews(
            $request->identity,
            (string) $request->get('status', 'pending'),
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
            $organizationId > 0 ? $organizationId : null,
        ));
    }

    public function decideReview(Request $request, string $id): Response
    {
        return ApiResponse::data((new CommunityQaService())->decideReview(
            $request->identity,
            $id,
            $this->input($request),
        ));
    }

    public function wikiDraft(Request $request, string $questionId, string $answerId): Response
    {
        return ApiResponse::data((new CommunityQaService())->wikiDraft(
            $request->identity,
            $questionId,
            $answerId,
            $this->input($request),
        ));
    }

    public function uploadAttachment(Request $request): Response
    {
        $file = $request->file('file');
        return ApiResponse::data([
            'attachment' => (new CommunityAttachmentService())->store(
                $request->identity,
                $file instanceof \Webman\Http\UploadFile ? $file : null,
            ),
        ], 201);
    }

    public function attachment(Request $request, string $id): Response
    {
        $file = (new CommunityAttachmentService())->authorize($request->identity ?? null, $id);
        $inline = str_starts_with($file['mimeType'], 'image/');
        return response()->file($file['path'])
            ->header('Content-Type', $file['mimeType'])
            ->header('Content-Disposition', (new AttachmentSecurityService())->contentDisposition($file['name'], $inline))
            ->header('X-Content-Type-Options', 'nosniff')
            ->header('Content-Security-Policy', "default-src 'none'; sandbox")
            ->header('Cache-Control', 'private, max-age=300');
    }

    private function input(Request $request): array
    {
        $post = $request->post();
        if ($post !== []) {
            return $post;
        }
        $decoded = json_decode($request->rawBody(), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function viewerKey(Request $request): string
    {
        if ($request->identity) {
            return 'user:' . $request->identity->id;
        }
        $seed = implode('|', [
            gmdate('Y-m-d'),
            (string) ($request->clientIp ?? $request->getRemoteIp()),
            mb_substr((string) $request->header('user-agent'), 0, 300),
        ]);
        return 'guest:' . hash_hmac('sha256', $seed, (string) config('wikist.secret', 'wikist'));
    }
}
