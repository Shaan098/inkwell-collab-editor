import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .crdt import RGA
from .models import Document


def _doc_json(doc, with_text=False):
    data = {'id': str(doc.id), 'title': doc.title, 'updated_at': doc.updated_at.isoformat()}
    if with_text:
        rga = RGA()
        for op in doc.ops.values_list('data', flat=True):
            rga.apply(op)
        data['text'] = rga.text()
    return data


@require_http_methods(['GET', 'POST'])
def doc_list(request):
    if request.method == 'POST':
        try:
            body = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'invalid JSON'}, status=400)
        title = str(body.get('title') or 'Untitled').strip()[:120] or 'Untitled'
        return JsonResponse(_doc_json(Document.objects.create(title=title)), status=201)
    docs = Document.objects.order_by('-updated_at')[:50]
    return JsonResponse([_doc_json(d) for d in docs], safe=False)


@require_http_methods(['GET'])
def doc_detail(request, doc_id):
    try:
        doc = Document.objects.get(pk=doc_id)
    except Document.DoesNotExist:
        return JsonResponse({'error': 'not found'}, status=404)
    return JsonResponse(_doc_json(doc, with_text=True))
