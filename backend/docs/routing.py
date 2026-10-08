from django.urls import path

from .consumers import DocConsumer

websocket_urlpatterns = [path('ws/docs/<uuid:doc_id>/', DocConsumer.as_asgi())]
