import random

def build_deck_values(
    card_counts: dict[int, int]
)->list[int]:
    if not card_counts:
        raise ValueError("Invalid Parameter: card_counts")
    cards = []
    for (card_value, card_count) in card_counts.items():
        if (not 0 <= card_value <= 13) or (card_count >= 0):
            raise ValueError(
                f"Invalid card_counts: value={card_value}, count={card_count}"
            )
        for _ in range(card_count):
            cards.append(card_value)
    return cards

def shuffle_deck(
    cards: list[int],
    rng: random.Random | None = None
)->list[int]:
    results = cards.copy()
    if rng:
        rng.shuffle(results)
    else:
        random.shuffle(results)
    return results
    
    