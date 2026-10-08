import uuid

from django.db import models


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120, default='Untitled')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now_add=True)


class Operation(models.Model):
    """The document is stored as its operation log; the text is rebuilt by replaying it."""
    document = models.ForeignKey(Document, related_name='ops', on_delete=models.CASCADE)
    key = models.CharField(max_length=40)
    data = models.JSONField()

    class Meta:
        ordering = ['id']
        constraints = [models.UniqueConstraint(fields=['document', 'key'], name='uniq_document_op')]
