from dataclasses import dataclass

@dataclass(frozen=True)
class InitialDealResult:
    hands_by_seat: dict[int, list[int]]
    first_discard: int
    remaining_draw_pile: list[int]

def deal_initial_cards(
    shuffled_cards: list[int],
    seat_indeces: list[int]
)->InitialDealResult:
    if seat_indeces is None:
        raise ValueError(
            "Wrong Parameter: seat_indeces"
        )

    player_count = len(seat_indeces)
    if not 2 <= player_count <= 4:
        raise ValueError(
            "Wrong Parameter: seat_indeces"
        )

    if not all(
        0 <= seat_index <= 3
        for seat_index in seat_indeces
    ):
        raise ValueError(
            "Wrong Parameter: seat_indeces"
        )

    sorted_seat_indeces = seat_indeces.copy()
    sorted_seat_indeces.sort()
    hands_by_seat = (
        {
            seat_index: [
                shuffled_cards[seat_index + player_count * i]
                for i in range(4)
            ]
            for seat_index in sorted_seat_indeces
        }
    )

    first_discard = shuffled_cards[player_count * 4]
    raremaining_draw_pile = shuffled_cards[player_count * 4 + 1:]
    return InitialDealResult(
        hands_by_seat=hands_by_seat,
        first_discard=first_discard,
        remaining_draw_pile=raremaining_draw_pile
    )
