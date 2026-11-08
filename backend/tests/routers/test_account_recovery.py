"""
Tests for profile changes and password recovery without e-mail.

Covers:
- PUT /api/auth/me requires the current password for e-mail/password changes
- Admin-created one-time reset links (POST /api/auth/users/{id}/reset-link)
- Public validation and completion of a reset (GET/POST /api/auth/password-reset/{token})
- Reset tokens are single-use and never work as access tokens
- Admin user updates (PATCH /api/auth/users/{id}) with self-lockout guards
"""

from app.services.auth_service import create_password_reset_token, decode_access_token


class TestProfileUpdate:
    def test_change_name_without_password(self, client, auth_headers):
        r = client.put("/api/auth/me", json={"full_name": "New Name"}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["full_name"] == "New Name"

    def test_change_password_requires_current(self, client, auth_headers):
        r = client.put("/api/auth/me", json={"password": "newpassword123"}, headers=auth_headers)
        assert r.status_code == 400
        assert "current password" in r.json()["detail"].lower()

    def test_change_password_wrong_current(self, client, auth_headers):
        r = client.put(
            "/api/auth/me",
            json={"password": "newpassword123", "current_password": "nope-nope"},
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "incorrect" in r.json()["detail"].lower()

    def test_change_password_success(self, client, auth_headers, test_user):
        r = client.put(
            "/api/auth/me",
            json={"password": "newpassword123", "current_password": "testpassword123"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        login = client.post("/api/auth/login", data={"username": test_user.email, "password": "newpassword123"})
        assert login.status_code == 200
        old = client.post("/api/auth/login", data={"username": test_user.email, "password": "testpassword123"})
        assert old.status_code == 401

    def test_change_email_requires_current_password(self, client, auth_headers):
        r = client.put("/api/auth/me", json={"email": "other@example.com"}, headers=auth_headers)
        assert r.status_code == 400

    def test_change_email_success(self, client, auth_headers):
        r = client.put(
            "/api/auth/me",
            json={"email": "other@example.com", "current_password": "testpassword123"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["email"] == "other@example.com"

    def test_cannot_escalate_via_profile(self, client, auth_headers):
        r = client.put("/api/auth/me", json={"is_admin": True, "is_active": False}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["is_admin"] is False
        assert r.json()["is_active"] is True


class TestResetLink:
    def test_non_admin_cannot_create_link(self, client, auth_headers, test_user):
        r = client.post(f"/api/auth/users/{test_user.id}/reset-link", headers=auth_headers)
        assert r.status_code == 403

    def test_admin_creates_link_and_user_resets(self, client, admin_auth_headers, test_user):
        r = client.post(f"/api/auth/users/{test_user.id}/reset-link", headers=admin_auth_headers)
        assert r.status_code == 200
        body = r.json()
        token = body["token"]
        assert body["path"] == f"/reset-password/{token}"

        check = client.get(f"/api/auth/password-reset/{token}")
        assert check.status_code == 200
        assert check.json()["valid"] is True
        assert check.json()["email"] == test_user.email

        done = client.post(f"/api/auth/password-reset/{token}", json={"password": "freshpassword1"})
        assert done.status_code == 200

        login = client.post("/api/auth/login", data={"username": test_user.email, "password": "freshpassword1"})
        assert login.status_code == 200

        # Token is spent once the password changed
        again = client.get(f"/api/auth/password-reset/{token}")
        assert again.json()["valid"] is False
        reuse = client.post(f"/api/auth/password-reset/{token}", json={"password": "anotherpassword1"})
        assert reuse.status_code == 400

    def test_reset_rejects_short_password(self, client, admin_auth_headers, test_user):
        token = client.post(f"/api/auth/users/{test_user.id}/reset-link", headers=admin_auth_headers).json()["token"]
        r = client.post(f"/api/auth/password-reset/{token}", json={"password": "short"})
        assert r.status_code == 422

    def test_garbage_token_invalid(self, client):
        r = client.get("/api/auth/password-reset/not-a-token")
        assert r.status_code == 200
        assert r.json()["valid"] is False

    def test_reset_token_is_not_an_access_token(self, client, test_user):
        token, _ = create_password_reset_token(test_user)
        assert decode_access_token(token) is None
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    def test_link_for_inactive_user_refused(self, client, admin_auth_headers, inactive_user):
        r = client.post(f"/api/auth/users/{inactive_user.id}/reset-link", headers=admin_auth_headers)
        assert r.status_code == 400

    def test_link_for_unknown_user(self, client, admin_auth_headers):
        r = client.post("/api/auth/users/9999/reset-link", headers=admin_auth_headers)
        assert r.status_code == 404


class TestAdminUserUpdate:
    def test_deactivate_and_reactivate(self, client, admin_auth_headers, test_user):
        r = client.patch(f"/api/auth/users/{test_user.id}", json={"is_active": False}, headers=admin_auth_headers)
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        login = client.post("/api/auth/login", data={"username": test_user.email, "password": "testpassword123"})
        assert login.status_code == 400
        r = client.patch(f"/api/auth/users/{test_user.id}", json={"is_active": True}, headers=admin_auth_headers)
        assert r.json()["is_active"] is True

    def test_promote_to_admin(self, client, admin_auth_headers, test_user):
        r = client.patch(f"/api/auth/users/{test_user.id}", json={"is_admin": True}, headers=admin_auth_headers)
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_admin_cannot_lock_themselves_out(self, client, admin_auth_headers, admin_user):
        r = client.patch(f"/api/auth/users/{admin_user.id}", json={"is_active": False}, headers=admin_auth_headers)
        assert r.status_code == 400
        r = client.patch(f"/api/auth/users/{admin_user.id}", json={"is_admin": False}, headers=admin_auth_headers)
        assert r.status_code == 400

    def test_non_admin_forbidden(self, client, auth_headers, test_user):
        r = client.patch(f"/api/auth/users/{test_user.id}", json={"full_name": "X"}, headers=auth_headers)
        assert r.status_code == 403
