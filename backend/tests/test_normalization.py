import pytest
from app.normalization import normalize_email, normalize_name
from app.exceptions import InvalidUsernameException, InvalidEmailAddressException

@pytest.mark.parametrize(
    "name, expected_result",
    [
        ("Alice", ("Alice", "alice")),
        ("alice", ("alice", "alice")),
        (" Alice ", ("Alice", "alice")),
        (" ALICE ", ("ALICE", "alice")),
    ]
)
def test_normalize_name_success(
    name,
    expected_result
):
    assert normalize_name(name) == expected_result

@pytest.mark.parametrize(
    "name",
    [
        ("     "),
        ("alice" * 50),
    ]
)
def test_normalize_name_exception(
    name
):
    with pytest.raises(
        InvalidUsernameException
    ):
        normalize_name(name)

@pytest.mark.parametrize(
    "email, expected_result",
    [
        ("Alice@gmail.com", ("Alice@gmail.com", "alice@gmail.com")),
        ("alice@gmail.com", ("alice@gmail.com", "alice@gmail.com")),
        ("alice+game@gmail.com", ("alice+game@gmail.com", "alice+game@gmail.com")),
        ("Alice@gmail.COM", ("Alice@gmail.com", "alice@gmail.com")),
    ]
)
def test_normalize_email_success(
    email,
    expected_result
):
    assert normalize_email(email) == expected_result

@pytest.mark.parametrize(
    "email",
    [
        ("     "),
        ("alice_gmail.com"),
    ]
)
def test_normalize_email_exception(
    email
):
    with pytest.raises(
        InvalidEmailAddressException
    ):
        normalize_email(email)