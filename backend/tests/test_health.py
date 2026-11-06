
def test_get_health_success(
    client
):
    response = client.get(
        "/health"
    )

    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "ok"
    