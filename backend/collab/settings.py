import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-only-change-me')
DEBUG = os.environ.get('DEBUG', '1') == '1'
ALLOWED_HOSTS = [h for h in os.environ.get('ALLOWED_HOSTS', '*').split(',') if h]

INSTALLED_APPS = [
    'daphne',  # must be first: makes `runserver` serve ASGI (needed for websockets)
    'django.contrib.staticfiles',
    'corsheaders',
    'channels',
    'docs',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'collab.urls'
ASGI_APPLICATION = 'collab.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('SQLITE_PATH', BASE_DIR / 'db.sqlite3'),
    }
}

# In-memory layer works for one process (dev). Set REDIS_URL to scale out.
# `capacity` = how many relayed messages may queue per connection before the layer
# starts dropping them. Clients repair any drop by themselves (ping/resync).
CHANNEL_CAPACITY = int(os.environ.get('CHANNEL_CAPACITY', '2000'))
if os.environ.get('REDIS_URL'):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [os.environ['REDIS_URL']], 'capacity': CHANNEL_CAPACITY},
        }
    }
else:
    CHANNEL_LAYERS = {
        'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer', 'CONFIG': {'capacity': CHANNEL_CAPACITY}}
    }

# The API has no cookies or login, so open CORS is fine for this demo.
CORS_ALLOW_ALL_ORIGINS = True

USE_TZ = True
TIME_ZONE = 'UTC'
STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
