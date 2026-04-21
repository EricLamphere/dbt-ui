from typing import Literal

SelectMode = Literal["only", "upstream", "downstream", "full"]


def build_selector(model_name: str, mode: SelectMode) -> str:
    """Build a dbt --select string for a model in the given mode.

    - only       → 'model_name'
    - upstream   → '+model_name'
    - downstream → 'model_name+'
    - full       → '+model_name+'
    """
    if mode == "only":
        return model_name
    if mode == "upstream":
        return f"+{model_name}"
    if mode == "downstream":
        return f"{model_name}+"
    if mode == "full":
        return f"+{model_name}+"
    raise ValueError(f"unknown select mode: {mode}")
