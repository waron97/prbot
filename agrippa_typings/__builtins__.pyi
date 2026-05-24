from typing import (
    Any,
    Dict,
    List,
    Literal,
    Optional,
    Tuple,
    Type,
    TypeVar,
    Union,
)
import logging
import datetime as _dt

from recordset import Recordset
from odoo_environment import OdooEnvironment
from odoo_records import _HelpdeskTicket
from b2w_entities import Asset, Contract, Order, OrderItem, Task

class Cursor:
    def execute(self, query: str, params: Any = None) -> None: ...
    def fetchone(self) -> Optional[Tuple[Any, ...]]: ...
    def fetchall(self) -> List[Tuple[Any, ...]]: ...
    def rollback(self) -> None: ...
    def commit(self) -> None: ...

class Response:
    status_code: int
    text: str
    content: bytes
    headers: Dict[str, str]
    ok: bool
    def json(self) -> Any: ...
    def raise_for_status(self) -> None: ...

# --- Globals ---

case_id: _HelpdeskTicket
env: OdooEnvironment
body: Dict[str, Any]
args: List[Any]
model: Recordset
logger: logging.Logger

# --- Functions ---

def log(
    message: Any, level: Literal["debug", "info", "warning", "error"] = ...
) -> None: ...
def json_dumps(
    obj: Any,
    *,
    indent: Optional[int] = None,
    sort_keys: bool = False,
    default: Any = None,
    ensure_ascii: bool = True,
) -> str: ...
def json_loads(s: str) -> Any: ...
def make_response(
    status: Tuple[int, int],
    message: Union[str, Dict[str, Any]],
) -> Any: ...
def request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    data: Optional[Union[str, bytes]] = None,
    json: Optional[Any] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> Response: ...

FirstArg = TypeVar("FirstArg")

def first(recordset: FirstArg) -> FirstArg: ...
def format_exc() -> str: ...

# --- Exceptions ---

class ValidationError(Exception): ...

# --- Datetime types (injected as the datetime module, not bare classes) ---

class _DatetimeModule:
    datetime: Type[_dt.datetime]
    date: Type[_dt.date]
    time: Type[_dt.time]
    timezone: Type[_dt.timezone]
    timedelta: Type[_dt.timedelta]
    MINYEAR: int
    MAXYEAR: int

datetime: _DatetimeModule
date: Type[_dt.date]
time: Type[_dt.time]
timezone: Type[_dt.timezone]
pytz: Any
dateutil: Any
