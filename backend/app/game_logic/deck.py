import random

def build_deck_values(
    card_counts: dict[int, int]
)->list[int]:
    if not card_counts:
        raise ValueError("Invalid Parameter: card_counts")
    cards = []
    for (card_value, card_count) in card_counts.items():
        if (
            type(card_value) is not int
            or not 0 <= card_value <= 13
            or type(card_count) is not int
            or card_count < 0
        ):
            raise ValueError(
                f"Invalid card_counts: value={card_value}, count={card_count}"
            )
        for _ in range(card_count):
            cards.append(card_value)
    if not cards:
        raise ValueError("Deck cannot be empty")
    return cards

def shuffle_deck(
    cards: list[int],
    rng: random.Random | None = None
)->list[int]:
    results = cards.copy()
    if rng is not None:
        rng.shuffle(results)
    else:
        random.shuffle(results)
    return results
    
    