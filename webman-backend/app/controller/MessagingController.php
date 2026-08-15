<?php

namespace app\controller;

use app\http\ApiResponse;
use app\service\CentrifugoTokenService;
use app\service\KnowledgeObjectResolver;
use app\service\MessagingAttachmentService;
use app\service\MessagingChannels;
use app\service\MessagingPermissionService;
use app\service\MessagingService;
use app\repository\MessagingRepository;
use support\Request;
use support\Response;

final class MessagingController
{
    public function bootstrap(Request $request): Response
    {
        return ApiResponse::data((new MessagingService())->bootstrap($request->identity));
    }

    public function conversations(Request $request): Response
    {
        return ApiResponse::data((new MessagingService())->conversations($request->identity, [
            'page' => (int) $request->get('page', 1),
            'limit' => (int) $request->get('limit', 24),
            'search' => (string) $request->get('q', ''),
            'kind' => (string) $request->get('kind', ''),
        ]));
    }

    public function preferences(Request $request): Response
    {
        return ApiResponse::data(['preferences' => (new MessagingService())->preferences($request->identity)]);
    }

    public function updatePreferences(Request $request): Response
    {
        return ApiResponse::data(['preferences' => (new MessagingService())->updatePreferences(
            $request->identity,
            $this->input($request),
        )]);
    }

    public function inbox(Request $request): Response
    {
        $service = new MessagingService();
        $items = $service->conversations($request->identity, [
            'page' => 1,
            'limit' => max(1, min(20, (int) $request->get('limit', 8))),
        ]);
        return ApiResponse::data([
            'items' => $items['items'],
            'pagination' => $items,
            'unreadCount' => (new MessagingRepository())->unreadCount($request->identity->id),
        ]);
    }

    public function direct(Request $request): Response
    {
        $input = $this->input($request);
        return ApiResponse::data([
            'conversation' => (new MessagingService())->startDirect($request->identity, (int) ($input['userId'] ?? 0)),
        ], 201);
    }

    public function organization(Request $request): Response
    {
        $input = $this->input($request);
        $id = $input['organizationId'] ?? $input['organizationSlug'] ?? '';
        return ApiResponse::data([
            'conversation' => (new MessagingService())->organizationConversation($request->identity, is_numeric($id) ? (int) $id : (string) $id),
        ]);
    }

    public function show(Request $request, string $id): Response
    {
        return ApiResponse::data(['conversation' => (new MessagingService())->conversation($request->identity, $id)]);
    }

    public function messages(Request $request, string $id): Response
    {
        $before = (int) $request->get('before', 0);
        return ApiResponse::data((new MessagingService())->messagePage(
            $request->identity,
            $id,
            $before > 0 ? $before : null,
            (int) $request->get('limit', 50),
        ));
    }

    public function members(Request $request, string $id): Response
    {
        return ApiResponse::data((new MessagingService())->members(
            $request->identity,
            $id,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 12),
        ));
    }

    public function send(Request $request, string $id): Response
    {
        return ApiResponse::data([
            'message' => (new MessagingService())->send($request->identity, $id, $this->input($request)),
        ], 201);
    }

    public function read(Request $request, string $id): Response
    {
        $input = $this->input($request);
        $cursor = (int) ($input['cursor'] ?? 0);
        return ApiResponse::data((new MessagingService())->markRead($request->identity, $id, $cursor > 0 ? $cursor : null));
    }

    public function readAll(Request $request): Response
    {
        return ApiResponse::data((new MessagingService())->markAllRead($request->identity));
    }

    public function settings(Request $request, string $id): Response
    {
        return ApiResponse::data([
            'conversation' => (new MessagingService())->updateMembership($request->identity, $id, $this->input($request)),
        ]);
    }

    public function moderation(Request $request, string $id): Response
    {
        return ApiResponse::data([
            'conversation' => (new MessagingService())->updateOrganizationModeration(
                $request->identity,
                $id,
                $this->input($request),
            ),
        ]);
    }

    public function memberRole(Request $request, string $id, string $userId): Response
    {
        return ApiResponse::data((new MessagingService())->updateOrganizationMemberRole(
            $request->identity,
            $id,
            (int) $userId,
            $this->input($request),
        ));
    }

    public function memberMute(Request $request, string $id, string $userId): Response
    {
        return ApiResponse::data((new MessagingService())->updateOrganizationMemberMute(
            $request->identity,
            $id,
            (int) $userId,
            $this->input($request),
        ));
    }

    public function typing(Request $request, string $id): Response
    {
        return ApiResponse::data((new MessagingService())->typing(
            $request->identity,
            $id,
            (bool) ($this->input($request)['active'] ?? true),
        ));
    }

    public function presence(Request $request, string $id): Response
    {
        return ApiResponse::data((new MessagingService())->presence($request->identity, $id));
    }

    public function heartbeat(Request $request): Response
    {
        $input = $this->input($request);
        return ApiResponse::data((new MessagingService())->heartbeat(
            $request->identity,
            is_array($input['userIds'] ?? null) ? $input['userIds'] : [],
            (string) ($input['context'] ?? ''),
            (string) ($input['clientId'] ?? 'legacy'),
        ));
    }

    public function offline(Request $request): Response
    {
        $input = $this->input($request);
        return ApiResponse::data((new MessagingService())->offline(
            $request->identity,
            (string) ($input['clientId'] ?? ''),
        ));
    }

    public function withdraw(Request $request, string $id): Response
    {
        return ApiResponse::data(['message' => (new MessagingService())->withdraw($request->identity, $id)]);
    }

    public function hide(Request $request, string $id): Response
    {
        return ApiResponse::data((new MessagingService())->hide($request->identity, $id));
    }

    public function upload(Request $request): Response
    {
        $file = $request->file('file');
        return ApiResponse::data([
            'attachment' => (new MessagingAttachmentService())->store(
                $request->identity,
                $file instanceof \Webman\Http\UploadFile ? $file : null,
            ),
        ], 201);
    }

    public function attachment(Request $request, string $id): Response
    {
        $file = (new MessagingAttachmentService())->authorize($request->identity, $id);
        $inline = str_starts_with($file['mimeType'], 'image/') || $file['mimeType'] === 'application/pdf';
        $name = str_replace(["\r", "\n", '"'], '', $file['name']);
        return response()->file($file['path'])
            ->header('Content-Type', $file['mimeType'])
            ->header('Content-Disposition', ($inline ? 'inline' : 'attachment') . '; filename="' . $name . '"')
            ->header('X-Content-Type-Options', 'nosniff')
            ->header('Cache-Control', 'private, max-age=300');
    }

    public function connectionToken(Request $request): Response
    {
        (new MessagingPermissionService())->synchronize($request->identity);
        return ApiResponse::data((new CentrifugoTokenService())->connectionToken($request->identity) + [
            'url' => (string) config('wikist.centrifugo.public_url'),
            'enabled' => (bool) config('wikist.centrifugo.enabled', false),
        ]);
    }

    public function subscriptionToken(Request $request, string $id): Response
    {
        (new MessagingPermissionService())->conversation($request->identity, $id);
        return ApiResponse::data((new CentrifugoTokenService())->subscriptionToken(
            $request->identity,
            MessagingChannels::conversation($id),
        ));
    }

    public function objectSuggestions(Request $request): Response
    {
        return ApiResponse::data(['items' => (new KnowledgeObjectResolver())->suggest(
            (string) $request->get('type', 'wiki_entry'),
            (string) $request->get('q', ''),
            $request->identity->id,
            (int) $request->get('limit', 12),
        )]);
    }

    public function userSuggestions(Request $request): Response
    {
        return ApiResponse::data(['items' => (new MessagingRepository())->searchUsers(
            (string) $request->get('q', ''),
            $request->identity->id,
            (int) $request->get('limit', 12),
        )]);
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
}
