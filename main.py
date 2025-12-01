import requests
import smtplib
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from bs4 import BeautifulSoup
import sys

# Configuration
UBC_URL = "https://www.educationplannerbc.ca/"
CHECK_INTERVAL = 60  # Check every 60 seconds
MAINTENANCE_TEXT = "undergoing temporary system maintenance"

# Email configuration
SENDER_EMAIL = "starlliott@gmail.com"
SENDER_PASSWORD = "sbgt keyu ziuu spqw"
RECIPIENT_EMAIL = "starlliott@gmail.com"

def send_email(subject, body):
    """Send an email notification using SMTP"""
    try:
        msg = MIMEMultipart()
        msg['From'] = SENDER_EMAIL
        msg['To'] = RECIPIENT_EMAIL
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        # Connect to Gmail SMTP server
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        text = msg.as_string()
        server.sendmail(SENDER_EMAIL, RECIPIENT_EMAIL, text)
        server.quit()
        
        print(f"✓ Email sent: {subject}")
        return True
    except smtplib.SMTPAuthenticationError:
        print(f"✗ Email authentication failed - check your password")
        return False
    except smtplib.SMTPException as e:
        print(f"✗ SMTP error: {e}")
        return False
    except Exception as e:
        print(f"✗ Error sending email: {e}")
        return False

def check_page_status():
    """Check if the maintenance message is still present"""
    try:
        response = requests.get(UBC_URL, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        page_text = soup.get_text().lower()
                
        # Check if maintenance message is present
        if MAINTENANCE_TEXT in page_text:
            return "maintenance"
        else:
            return "online"
    except requests.RequestException as e:
        print(f"✗ Error fetching page: {e}")
        return "error"

def main():
    print("🔍 Starting UBC EducationPlannerBC monitor...")
    print(f"📧 Alerts will be sent to: {RECIPIENT_EMAIL}")
    print(f"⏱️  Checking every {CHECK_INTERVAL} seconds\n")
    
    was_in_maintenance = True
    
    try:
        while True:
            status = check_page_status()
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            
            if status == "maintenance":
                print(f"[{timestamp}] 🔧 Still under maintenance...")
                was_in_maintenance = True
            elif status == "online":
                if was_in_maintenance:
                    print(f"[{timestamp}] ✅ Page is back online! Sending email...")
                    send_email(
                        "UBC EducationPlannerBC is Back Online!",
                        "The EducationPlannerBC application is now available.\n\nVisit: " + UBC_URL
                    )
                    was_in_maintenance = False
                else:
                    print(f"[{timestamp}] ✅ Page is online")
            else:
                print(f"[{timestamp}] ⚠️  Error checking page status")
            
            time.sleep(CHECK_INTERVAL)
    
    except KeyboardInterrupt:
        print("\n\n👋 Monitor stopped by user")
        sys.exit(0)

if __name__ == "__main__":
    main()