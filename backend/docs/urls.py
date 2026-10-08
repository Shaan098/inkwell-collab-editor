from django.urls import path

from . import views

urlpatterns = [
    path('docs/', views.doc_list),
    path('docs/<uuid:doc_id>/', views.doc_detail),
]
