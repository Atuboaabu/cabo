from app.game_logic.deck import build_deck_values

CABO_COUNTS: dict[int, int] = {
# card_value: card_count
    0: 2,
    1: 4,
    2: 4,
    3: 4,
    4: 4,
    5: 4,
    6: 4,
    7: 4,
    8: 4,
    9: 4,
    10: 4,
    11: 4,
    12: 4,
    13: 2,
}

INITIAL_PEEK_DURATION_SECONDS: int = 45
TURN_DURATION_SECONDS: int = 90

def build_cabo_deck()->list[int]:
    return build_deck_values(CABO_COUNTS)