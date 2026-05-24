from typing import Any, Dict, List, Optional
from odoo_environment import OdooEnvironment


class Bit2winEntity:
    env: OdooEnvironment
    _id: str
    data: Dict[str, Any]

    def __init__(self, env: OdooEnvironment, _id: str, data: Optional[Dict[str, Any]] = None) -> None: ...
    def patch(self, new_data: Any, method: str = "PATCH") -> Any: ...
    def download(self) -> Dict[str, Any]: ...


class Asset(Bit2winEntity):
    def children(self) -> "List[Asset]": ...
    def order(self) -> "Order": ...
    def order_item(self) -> "OrderItem": ...
    def contract(self) -> "Contract": ...
    def offer_codes(self) -> List[Dict[str, Any]]: ...
    def offer_code(self, at: Any = None) -> Optional[str]: ...
    def update_b2w_statemodel(
        self,
        destination_state: str,
        sm_reason: str = "",
        expected_date: Any = False,
    ) -> Any: ...


class Order(Bit2winEntity):
    def order_items(self) -> "List[OrderItem]": ...
    def update_b2w_statemodel(
        self,
        destination_state: str,
        sm_reason: str = "",
        expected_date: Any = False,
    ) -> Any: ...


class OrderItem(Bit2winEntity):
    order_id: Optional[str]

    def __init__(
        self,
        env: OdooEnvironment,
        _id: str,
        order_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> None: ...
    def task_mdp(self) -> "Optional[Task]": ...
    def update_b2w_statemodel(
        self,
        destination_state: str,
        sm_reason: str = "",
        expected_date: Any = False,
    ) -> Any: ...


class Contract(Bit2winEntity):
    def update_b2w_statemodel(
        self,
        destination_state: str,
        sm_reason: str = "",
        expected_date: Any = False,
    ) -> Any: ...


class Task(Bit2winEntity): ...
