from dataclasses import dataclass

@dataclass(frozen=True)
class InitialDealResult:
    hands_by_seat: dict[int, list[int]]
    first_discard: int
    remaining_draw_pile: list[int]

def deal_initial_cards(
    shuffled_cards: list[int],
    seat_indices: list[int]
)->InitialDealResult:
    if seat_indices is None:
        raise ValueError(
            "Wrong Parameter: seat_indices"
        )

    player_count = len(seat_indices)
    if not 2 <= player_count <= 4:
        raise ValueError(
            "Wrong Parameter: seat_indices"
        )

    if not all(
        type(seat_index) is int and 0 <= seat_index <= 3
        for seat_index in seat_indices
    ):
        raise ValueError(
            "Wrong Parameter: seat_indices"
        )

    if len(set(seat_indices)) != player_count:
        raise ValueError(
            "Wrong Parameter: duplicate seat_index in seat_indices"
        )

    required_card_count = player_count * 4 + 1
    if len(shuffled_cards) < required_card_count:
        raise ValueError(
            "Insufficient cards for initial deal"
        )

    sorted_seat_indices = seat_indices.copy()
    sorted_seat_indices.sort()
    hands_by_seat = (
        {
            seat_index: [
                shuffled_cards[deal_index + player_count * i]
                for i in range(4)
            ]
            for deal_index, seat_index in enumerate(sorted_seat_indices)
        }
    )

    first_discard = shuffled_cards[player_count * 4]
    remaining_draw_pile = shuffled_cards[player_count * 4 + 1:]
    return InitialDealResult(
        hands_by_seat=hands_by_seat,
        first_discard=first_discard,
        remaining_draw_pile=remaining_draw_pile
    )
