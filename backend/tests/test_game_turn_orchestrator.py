from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import threading
import uuid

import pytest
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (GameCard, GameCommandRequest, GamePlayer, GameSession,
                        GameTurn, Room, UserAccount)
from app.services import game, game_command, game_turn


engine = create_engine(
    url=settings.test_database_url,
    echo=settings.sql_echo,
)


@dataclass(frozen=True)
class GameFixture:
    game_session_id: uuid.UUID
    account_by_seat: dict[int, uuid.UUID]
    player_by_seat: dict[int, uuid.UUID]
    acting_seat: int
    main_card_id: uuid.UUID
    old_card_id: uuid.UUID
    old_card_value: int
    main_card_source: str


def _cleanup(
    game_session_id: uuid.UUID | None,
    room_id: uuid.UUID | None,
    account_ids: list[uuid.UUID],
) -> None:
    with Session(engine) as session:
        if game_session_id is not None:
            session.execute(
                delete(GameCommandRequest).where(
                    GameCommandRequest.game_session_id == game_session_id
                )
            )
            session.execute(
                delete(GameTurn).where(
                    GameTurn.game_session_id == game_session_id
                )
            )
            session.execute(
                delete(GameCard).where(
                    GameCard.game_session_id == game_session_id
                )
            )
            session.execute(
                delete(GamePlayer).where(
                    GamePlayer.game_session_id == game_session_id
                )
            )
            session.execute(
                delete(GameSession).where(
                    GameSession.id == game_session_id
                )
            )
        if room_id is not None:
            session.execute(
                delete(Room).where(Room.id == room_id)
            )
        if account_ids:
            session.execute(
                delete(UserAccount).where(
                    UserAccount.id.in_(account_ids)
                )
            )
        session.commit()


@contextmanager
def game_fixture(
    *,
    seats: tuple[int, ...] = (0, 1),
    acting_seat: int = 0,
    draw_pile_count: int = 10,
    main_card_source: str = "DrawPile",
):
    suffix = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    account_ids: list[uuid.UUID] = []
    room_id: uuid.UUID | None = None
    game_session_id: uuid.UUID | None = None
    fixture: GameFixture | None = None

    try:
        with Session(engine) as session:
            users = [
                UserAccount(
                    username=f"u{seat}_{suffix[:8]}",
                    normalized_username=f"u{seat}_{suffix}",
                    email=f"u{seat}_{suffix}@test.local",
                    normalized_email=f"u{seat}_{suffix}@test.local",
                    hashed_password="test-only",
                )
                for seat in seats
            ]
            session.add_all(users)
            session.flush()
            account_ids = [user.id for user in users]

            room = Room(
                room_code=f"T{suffix[:7]}",
                host_account_id=users[0].id,
                state="Playing",
            )
            session.add(room)
            session.flush()
            room_id = room.id

            game_session = GameSession(
                room_id=room.id,
                state="Playing",
                phase="PlayerTurn",
                state_revision=5,
            )
            session.add(game_session)
            session.flush()
            game_session_id = game_session.id

            players = [
                GamePlayer(
                    game_session_id=game_session.id,
                    account_id=user.id,
                    seat_index=seat,
                    initial_peek_completed=True,
                )
                for user, seat in zip(users, seats)
            ]
            session.add_all(players)
            session.flush()
            player_by_seat = {
                player.seat_index: player.id
                for player in players
            }
            account_by_seat = {
                seat: user.id
                for user, seat in zip(users, seats)
            }
            acting_player = next(
                player
                for player in players
                if player.seat_index == acting_seat
            )

            old_card: GameCard | None = None
            for player in players:
                for position in range(4):
                    game_card = GameCard(
                        game_session_id=game_session.id,
                        value=(
                            7
                            if player.seat_index == acting_seat and position == 0
                            else (player.seat_index + position) % 14
                        ),
                        location="Hand",
                        owner_game_player_id=player.id,
                        position=position,
                        face_up=False,
                    )
                    session.add(game_card)
                    if player.seat_index == acting_seat and position == 0:
                        old_card = game_card

            main_card = GameCard(
                game_session_id=game_session.id,
                value=11,
                location="PendingAction",
                owner_game_player_id=None,
                position=0,
                face_up=(main_card_source == "DiscardPile"),
            )
            session.add(main_card)

            session.add(
                GameCard(
                    game_session_id=game_session.id,
                    value=3,
                    location="DiscardPile",
                    owner_game_player_id=None,
                    position=0,
                    face_up=True,
                )
            )

            for position in range(draw_pile_count):
                session.add(
                    GameCard(
                        game_session_id=game_session.id,
                        value=4,
                        location="DrawPile",
                        owner_game_player_id=None,
                        position=position,
                        face_up=False,
                    )
                )

            session.flush()
            assert old_card is not None

            session.add(
                GameTurn(
                    game_session_id=game_session.id,
                    game_player_id=acting_player.id,
                    turn_number=1,
                    state="AwaitingCardDecision",
                    started_at=now,
                    deadline_at=now + timedelta(seconds=90),
                    main_card_id=main_card.id,
                    main_card_source=main_card_source,
                )
            )
            session.commit()

            fixture = GameFixture(
                game_session_id=game_session.id,
                account_by_seat=account_by_seat,
                player_by_seat=player_by_seat,
                acting_seat=acting_seat,
                main_card_id=main_card.id,
                old_card_id=old_card.id,
                old_card_value=old_card.value,
                main_card_source=main_card_source,
            )

        yield fixture
    finally:
        _cleanup(game_session_id, room_id, account_ids)


def replace(fixture: GameFixture, request_id: uuid.UUID, position: int = 0):
    with Session(engine) as session:
        user = session.get(
            UserAccount,
            fixture.account_by_seat[fixture.acting_seat],
        )
        assert user is not None
        return game_command.single_card_replace_command(
            session,
            user,
            fixture.game_session_id,
            request_id,
            position,
        )


@pytest.mark.parametrize(
    "seats,acting_seat,expected_next_seat",
    [
        ((0, 1), 0, 1),
        ((0, 1), 1, 0),
        ((0, 1, 2), 1, 2),
        ((0, 1, 2), 2, 0),
        ((0, 1, 2, 3), 3, 0),
        ((0, 2, 3), 3, 0),
    ],
)
def test_replace_schedules_next_turn_clockwise(
    seats,
    acting_seat,
    expected_next_seat,
):
    with game_fixture(
        seats=seats,
        acting_seat=acting_seat,
        draw_pile_count=10,
    ) as fixture:
        outcome = replace(fixture, uuid.uuid4())
        assert outcome.status == "Accepted"

        with Session(engine) as session:
            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            assert game_session.state == "Playing"
            assert game_session.phase == "PlayerTurn"
            assert game_session.state_revision == 6

            turns = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id
                ).order_by(GameTurn.turn_number)
            ).scalars().all()
            assert len(turns) == 2

            completed_turn, next_turn = turns
            assert completed_turn.state == "Completed"
            assert completed_turn.ended_at is not None
            assert next_turn.state == "AwaitingAction"
            assert next_turn.turn_number == 2
            assert next_turn.game_player_id == fixture.player_by_seat[expected_next_seat]
            assert next_turn.main_card_id is None
            assert next_turn.main_card_source is None
            assert next_turn.deadline_at - next_turn.started_at == timedelta(seconds=90)

            active_turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.ended_at.is_(None),
                )
            ).scalar_one()
            assert active_turn_count == 1

            main_card = session.get(GameCard, fixture.main_card_id)
            old_card = session.get(GameCard, fixture.old_card_id)
            assert main_card is not None
            assert old_card is not None
            assert main_card.location == "Hand"
            assert main_card.owner_game_player_id == fixture.player_by_seat[acting_seat]
            assert main_card.face_up is (fixture.main_card_source == "DiscardPile")
            assert old_card.location == "DiscardPile"
            assert old_card.face_up is True

            viewer = session.get(
                UserAccount,
                fixture.account_by_seat[acting_seat],
            )
            assert viewer is not None
            view = game.get_game_view(
                session,
                viewer,
                fixture.game_session_id,
            )
            assert view.phase == "PlayerTurn"
            assert view.active_turn is not None
            assert view.active_turn.turn_number == 2
            assert (
                view.active_turn.acting_account_id
                == fixture.account_by_seat[expected_next_seat]
            )
            assert view.discard_pile.top_card_value == fixture.old_card_value

            acting_player_view = next(
                player
                for player in view.players
                if player.account_id == fixture.account_by_seat[acting_seat]
            )
            replaced_card = next(
                card
                for card in acting_player_view.hand_cards
                if card.position == 0
            )
            assert replaced_card.face_up is False
            assert "value" not in replaced_card.model_dump()


def test_empty_draw_pile_enters_settling_without_successor():
    with game_fixture(
        seats=(0, 1, 2),
        acting_seat=1,
        draw_pile_count=0,
        main_card_source="DrawPile",
    ) as fixture:
        outcome = replace(fixture, uuid.uuid4())
        assert outcome.status == "Accepted"

        with Session(engine) as session:
            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            assert game_session.state == "Playing"
            assert game_session.phase == "Settling"
            assert game_session.state_revision == 6

            turns = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id
                )
            ).scalars().all()
            assert len(turns) == 1
            assert turns[0].state == "Completed"
            assert turns[0].ended_at is not None

            active_turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.ended_at.is_(None),
                )
            ).scalar_one()
            assert active_turn_count == 0

            main_card = session.get(GameCard, fixture.main_card_id)
            old_card = session.get(GameCard, fixture.old_card_id)
            assert main_card is not None
            assert old_card is not None
            assert main_card.location == "Hand"
            assert main_card.face_up is False
            assert old_card.location == "DiscardPile"
            assert old_card.face_up is True

        for seat in (0, 1, 2):
            with Session(engine) as session:
                viewer = session.get(
                    UserAccount,
                    fixture.account_by_seat[seat],
                )
                assert viewer is not None
                view = game.get_game_view(
                    session,
                    viewer,
                    fixture.game_session_id,
                )
                assert view.phase == "Settling"
                assert view.active_turn is None
                assert view.initial_peek_deadline_at is None
                assert view.draw_pile.card_count == 0
                assert view.discard_pile.top_card_value == fixture.old_card_value

                acting_player_view = next(
                    player
                    for player in view.players
                    if player.account_id == fixture.account_by_seat[fixture.acting_seat]
                )
                hidden_card = next(
                    card
                    for card in acting_player_view.hand_cards
                    if card.position == 0
                )
                assert hidden_card.face_up is False
                assert "value" not in hidden_card.model_dump()

        with Session(engine) as session:
            user = session.get(
                UserAccount,
                fixture.account_by_seat[0],
            )
            assert user is not None
            rejection = game_command.draw_from_drawpile_command(
                session,
                user,
                fixture.game_session_id,
                uuid.uuid4(),
            )
            assert rejection.status == "Rejected"
            assert rejection.reason == "INVALID_GAME_STATE"


def test_same_request_replay_does_not_advance_twice():
    with game_fixture(draw_pile_count=10) as fixture:
        request_id = uuid.uuid4()
        first = replace(fixture, request_id)
        assert first.status == "Accepted"
        assert first.replayed is False

        second = replace(fixture, request_id)
        assert second.status == "Accepted"
        assert second.replayed is True

        with Session(engine) as session:
            turns = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id
                )
            ).scalars().all()
            assert len(turns) == 2

            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            assert game_session.state_revision == 6

            request_count = session.execute(
                select(func.count()).select_from(GameCommandRequest).where(
                    GameCommandRequest.game_session_id == fixture.game_session_id,
                    GameCommandRequest.request_id == request_id,
                )
            ).scalar_one()
            assert request_count == 1


def test_new_request_after_completion_is_rejected():
    with game_fixture(draw_pile_count=10) as fixture:
        first = replace(fixture, uuid.uuid4())
        assert first.status == "Accepted"

        second = replace(fixture, uuid.uuid4())
        assert second.status == "Rejected"
        assert second.reason == "GAMETURN_STATE_ERROR"

        with Session(engine) as session:
            turns = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id
                )
            ).scalars().all()
            assert len(turns) == 2

            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            assert game_session.state_revision == 6

            request_count = session.execute(
                select(func.count()).select_from(GameCommandRequest).where(
                    GameCommandRequest.game_session_id == fixture.game_session_id,
                )
            ).scalar_one()
            assert request_count == 2


def test_scheduler_rejects_duplicate_advance():
    with game_fixture(draw_pile_count=10) as fixture:
        first = replace(fixture, uuid.uuid4())
        assert first.status == "Accepted"

        with Session(engine) as session:
            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            completed_turn = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.state == "Completed",
                )
            ).scalar_one()

            with pytest.raises(RuntimeError, match="active Turn"):
                game_turn.advance_turn_after_completion(
                    session,
                    game_session,
                    completed_turn,
                )
            session.rollback()

        with Session(engine) as session:
            turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                )
            ).scalar_one()
            assert turn_count == 2


def test_scheduler_failure_rolls_back_replace_and_request(monkeypatch):
    with game_fixture(draw_pile_count=10) as fixture:
        request_id = uuid.uuid4()

        def fail_scheduling(*args, **kwargs):
            raise RuntimeError("scheduler failure")

        monkeypatch.setattr(
            game_turn,
            "advance_turn_after_completion",
            fail_scheduling,
        )

        with pytest.raises(RuntimeError, match="scheduler failure"):
            replace(fixture, request_id)

        with Session(engine) as session:
            game_session = session.get(
                GameSession,
                fixture.game_session_id,
            )
            assert game_session is not None
            assert game_session.state == "Playing"
            assert game_session.phase == "PlayerTurn"
            assert game_session.state_revision == 5

            main_card = session.get(GameCard, fixture.main_card_id)
            old_card = session.get(GameCard, fixture.old_card_id)
            assert main_card is not None
            assert old_card is not None
            assert main_card.location == "PendingAction"
            assert old_card.location == "Hand"

            active_turn = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.ended_at.is_(None),
                )
            ).scalar_one()
            assert active_turn.state == "AwaitingCardDecision"

            turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                )
            ).scalar_one()
            assert turn_count == 1

            request_count = session.execute(
                select(func.count()).select_from(GameCommandRequest).where(
                    GameCommandRequest.game_session_id == fixture.game_session_id,
                    GameCommandRequest.request_id == request_id,
                )
            ).scalar_one()
            assert request_count == 0


def test_concurrent_replace_has_single_winner():
    with game_fixture(draw_pile_count=10) as fixture:
        barrier = threading.Barrier(2)
        results: list[tuple[str, str, str | None]] = []
        errors: list[BaseException] = []

        def worker(name: str, request_id: uuid.UUID) -> None:
            try:
                with Session(engine) as session:
                    user = session.get(
                        UserAccount,
                        fixture.account_by_seat[fixture.acting_seat],
                    )
                    assert user is not None
                    barrier.wait(timeout=10)
                    outcome = game_command.single_card_replace_command(
                        session,
                        user,
                        fixture.game_session_id,
                        request_id,
                        0,
                    )
                    results.append((name, outcome.status, outcome.reason))
            except BaseException as exc:
                errors.append(exc)

        threads = [
            threading.Thread(target=worker, args=("first", uuid.uuid4())),
            threading.Thread(target=worker, args=("second", uuid.uuid4())),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert not any(thread.is_alive() for thread in threads)
        assert errors == []
        assert sorted(status for _, status, _ in results) == ["Accepted", "Rejected"]

        with Session(engine) as session:
            turns = session.execute(
                select(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id
                ).order_by(GameTurn.turn_number)
            ).scalars().all()
            assert len(turns) == 2
            assert turns[0].state == "Completed"
            assert turns[1].state == "AwaitingAction"

            active_turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.ended_at.is_(None),
                )
            ).scalar_one()
            assert active_turn_count == 1

            request_statuses = session.execute(
                select(GameCommandRequest.status).where(
                    GameCommandRequest.game_session_id == fixture.game_session_id,
                )
            ).scalars().all()
            assert sorted(request_statuses) == ["Accepted", "Rejected"]


def test_partial_unique_index_rejects_second_active_turn():
    with game_fixture(draw_pile_count=10) as fixture:
        now = datetime.now(timezone.utc)
        with Session(engine) as session:
            session.add(
                GameTurn(
                    game_session_id=fixture.game_session_id,
                    game_player_id=fixture.player_by_seat[fixture.acting_seat],
                    turn_number=2,
                    state="AwaitingAction",
                    started_at=now,
                    deadline_at=now + timedelta(seconds=90),
                )
            )
            with pytest.raises(IntegrityError):
                session.flush()
            session.rollback()

        with Session(engine) as session:
            active_turn_count = session.execute(
                select(func.count()).select_from(GameTurn).where(
                    GameTurn.game_session_id == fixture.game_session_id,
                    GameTurn.ended_at.is_(None),
                )
            ).scalar_one()
            assert active_turn_count == 1
