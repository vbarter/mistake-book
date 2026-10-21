from __future__ import annotations

from functools import wraps

from flask import abort, g
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from .extensions import db
from .models import User


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        user = db.session.get(User, get_jwt_identity())
        if user is None:
            abort(401)
        g.user = user
        return fn(*args, **kwargs)

    return wrapper


def current_user() -> User:
    return g.user
