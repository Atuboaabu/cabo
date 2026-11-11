import resend

from app.config import settings

resend.api_key = settings.resend_api_key

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
    result = await resend.Emails.send_async(params)
    return result["id"]