import resend
import httpx
import logging

from app.config import settings
from app.exc.exceptions import EmailSendFailedException

logger = logging.getLogger(__name__)

resend.api_key = settings.resend_api_key
resend.default_async_http_client = resend.HTTPXClient(
    timeout=10,
)

async def send_verification_email(
    email_to_address: str,
    verification_code: str
)->str:
    params: resend.Emails.SendParams = {
        "from": settings.email_from_address,
        "to": [email_to_address],
        "subject": "CABO验证码",
        "text": (
            f"【CABO】验证码为：{verification_code}，"
            "请在 5 分钟内使用，切勿将验证码泄露于他人，如非本人操作请忽略。"
        )
    }
    try:
        result = await resend.Emails.send_async(params)
        email_id = result["id"]
        logger.info("verification email accepted: email id = %s", email_id)
        return email_id

    except httpx.TimeoutException as exc:
        logger.warning("Resend http request timeout")
        raise EmailSendFailedException(
            "邮件服务请求超时"
        ) from exc

    except httpx.RequestError as exc:
        logger.warning("Resend http request failed, error_type=%s", type(exc).__name__)
        raise EmailSendFailedException(
            "邮件服务网络异常"
        ) from exc
    except resend.exceptions.ResendError as exc:
        logger.warning("Resend email sending error, error_type=%s", type(exc).__name__)
        raise EmailSendFailedException(
            "邮件服务发送失败"
        ) from exc