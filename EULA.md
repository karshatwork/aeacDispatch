# END USER LICENSE AGREEMENT (EULA)

**Software:** RecordKeeper Dispatch: Dispatch Management System  
**Licensor (Developer):** Karsh (Karsh Industrial Digital Solutions)  
**Licensee (Machine Manufacturer/Distributor):** Sukhmani Machines Private Limited  
**End-User (Sublicensee):** Abhishek Elektrosil Auto Components Private Limited  

**CAREFULLY READ THE FOLLOWING LICENSE AGREEMENT.** BY INSTALLING, COPYING, ACCESSING, OR OTHERWISE USING THE SOFTWARE BUNDLED WITH YOUR SPECIFIED HARDWARE WORKSTATION / DISPATCH TERMINAL, YOU (THE "END-USER" OR "COMPANY") ACCEPT AND AGREE TO BE BOUND BY THE TERMS AND CONDITIONS OF THIS END USER LICENSE AGREEMENT ("EULA"). IF YOU DO NOT AGREE TO THESE TERMS, DO NOT INSTALL, ACCESS, OR USE THE SOFTWARE.

---

## 1. NATURE OF THE LICENSE

The Software is **licensed, not sold**, and acts as an integrated system with the physical workstation, industrial barcode scanning hardware, and shop-floor dispatch terminal provided to you by the Manufacturer/Distributor (the "Licensee"). 
This EULA grants you a limited, non-exclusive, non-transferable, and highly restrictive sub-license to use the Software solely for your internal business operations (specifically Finished Goods dispatch management, FIFO verification, box traceability, and quality staging), under the specific constraints dictated by the hardware pairing and cryptographic license limits. 
Karsh ("Licensor" or "Developer") retains all ownership, rights, title, and interest in and to the Software, including any intellectual property rights, source code, bytecode, cryptographic engines, and proprietary algorithms therein.

## 2. SINGLE MACHINE BOUND (HARDWARE FINGERPRINTING)

This Software License is strictly bound to the **unique hardware fingerprint** (derived from the motherboard UUID, primary storage drive serial number, CPU identifiers, and machine platform signatures) of the specific workstation on which it was officially installed and delivered to you by the Licensee/Manufacturer.
- **Hardware Binding:** The Software continuously verifies its runtime environment against cryptographically signed hardware signatures using an asymmetric RSA-2048 verification engine.
- **Prohibition on Transfer:** You are expressly prohibited from migrating, virtualizing (e.g., running in a Virtual Machine, Docker container, or cloud/emulated environment), cloning, copying, or installing the Software onto any other physical computer, server, or device.
- **Replacement/Repair:** In the event of hardware failure necessitating replacement parts (such as a motherboard or primary storage drive), the hardware fingerprint will change, and the Software will automatically enter lockout mode. A replacement cryptographic license protocol authorized directly by the Licensor and Licensee must be followed to reinstate functionality.

## 3. USAGE LIMITATIONS & OPERATIONAL CONSTRAINTS

Your right to use the Software is restricted by predefined variables and cryptographic parameters configured at the time of your licensing agreement. These hardcoded and cryptographically signed parameters include, but are not limited to:
1. **Licensed Product Identifier:** The Software operates exclusively with license keys signed for this application.
2. **Authorized Feature Tiers:** Access to advanced modules (including FIFO Dispatch Enforcement, Box Traceability, Manager Staging Reopen, Production Analytics & Reports, CSV Export, and REST/WebSocket API Access) is governed strictly by the licensed feature tier.
3. **Time Limitations:** Software operation is strictly bound to the expiration date specified in the cryptographic license file (`license.key`). Upon expiration, the Software will restrict dispatch operations until a renewal key is cryptographically provisioned by the Licensor.
4. **Traceability & FIFO Integrity:** Any attempt to bypass, spoof, or manipulate barcode scanner data feeds, First-In First-Out (FIFO) staging sequence rules, batch hold/quarantine enforcement, or immutable audit records is a material violation of this agreement.

Any attempt to bypass, tamper with, alter, or spoof these limitations, cryptographic keys, or hardware bindings is a material breach of this EULA and will result in immediate automatic lockout of the Software, termination of your license, and potential legal action.

## 4. PROHIBITED ACTIONS

You agree that you will **NOT**, and will not permit any employee, contractor, or third party to:
1. Reverse engineer, decompile, decrypt, disassemble, or otherwise attempt to derive the source code or underlying algorithms of the Software.
2. Modify, translate, adapt, patch, or create derivative works from the Software or its configuration.
3. Rent, lease, lend, sell, redistribute, network-share, or sublicense the Software or access to its backend services outside the physical desktop workstation.
4. Attempt to circumvent the license verification or anti-tamper mechanisms.
5. Extract, query, or reuse embedded schemas, audit logs, or cryptographic keys outside the normal, authorized operation of the user interface.
6. Use the Software for any unlawful purpose or in a manner that negatively impacts the intellectual property rights of the Licensor.

## 5. DATA OWNERSHIP AND INDUSTRIAL RECORD INTEGRITY

You retain ownership of operational dispatch records, scanned box barcodes, staging logs, and quality audit trails created by you using the Software ("Operational Data"). However:
1. **Local & Database Storage Responsibility:** The Software operates on local workstation hardware and interfaces directly with your designated database instance. You are entirely responsible for implementing and maintaining database maintenance, network availability, and offsite backup strategies for your operational data.
2. **Data Loss Disclaimer:** Under no circumstances shall the Licensor or Licensee be held liable for delayed, corrupted, or lost Operational Data arising from network failures, database connection dropouts, hardware failures, operator error, or unexpected power interruptions.

## 6. AUDIT RIGHTS

The Licensor and Licensee reserve the right to periodically verify the Software's usage and operational environment to assure compliance with the terms of this EULA. This may include reviewing cryptographically signed runtime logs, hardware fingerprint status, and active feature tier authorizations.

## 7. DISCLAIMER OF ALL WARRANTIES

THE SOFTWARE IS PROVIDED TO YOU **"AS IS"** AND WITH ALL FAULTS AND DEFECTS WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED UNDER APPLICABLE LAW, THE LICENSOR EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, WITH RESPECT TO THE SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. THE LICENSOR PROVIDES NO WARRANTY OR UNDERTAKING THAT THE SOFTWARE WILL MEET YOUR REQUIREMENTS, ACHIEVE ANY SPECIFIC SHOP-FLOOR THROUGHPUT OR YIELD, OPERATE UNINTERRUPTED, SURVIVE HOST HARDWARE FAILURES, OR BE COMPATIBLE WITH NON-CERTIFIED THIRD-PARTY PERIPHERALS.

## 8. LIMITATION OF LIABILITY

TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL THE LICENSOR (KARSH) BE LIABLE FOR ANY CONSEQUENTIAL, INCIDENTAL, INDIRECT, EXEMPLARY, SPECIAL, OR PUNITIVE DAMAGES WHATSOEVER (INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOSS OF PRODUCTION, SHOP-FLOOR DOWNTIME, LOSS OF BUSINESS PROFITS, BUSINESS INTERRUPTION, LOSS OF DISPATCH RECORDS, SHIPPING DELAYS, CUSTOMER FINES, OR COST OF PROCUREMENT OF SUBSTITUTE SERVICES) ARISING OUT OF OR IN ANY WAY RELATED TO THE USE OF OR INABILITY TO USE THE SOFTWARE, EVEN IF THE LICENSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, AND REGARDLESS OF THE LEGAL OR EQUITABLE THEORY (CONTRACT, TORT, OR OTHERWISE) UPON WHICH THE CLAIM IS BASED.

IN NO EVENT SHALL THE LICENSOR'S AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS EULA EXCEED 10% OF THE ACTUAL AMOUNT PAID FOR THE SOFTWARE LICENSE ATTRIBUTABLE TO YOUR SPECIFIC DISPATCH WORKSTATION.

## 9. INDEMNIFICATION

You agree to indemnify, defend, and hold harmless the Licensor and its affiliates, officers, and developers from any claims, damages, liabilities, costs, and fees (including reasonable attorneys' fees) arising from:
1. Your use of the Software in a manner not authorized by this EULA or contrary to plant standard operating procedures (SOP).
2. Any physical dispatch errors, incorrect product shipments, or quality escapes resulting from operator negligence or improper barcode scanning procedures.
3. Any modifications, reverse-engineering attempts, or tampering with the Software, host workstation, or serial hardware interfaces.
4. Any breach of this EULA on your part.

## 10. TERM AND TERMINATION

This EULA shall remain strictly in effect until terminated.
1. **By You:** You may terminate this EULA at any time by ceasing all use of the Software and securely erasing all software binaries from the hardware.
2. **By Licensor:** Your rights under this EULA will terminate automatically without notice from the Licensor if you fail to comply with any of its terms, including hardware binding constraints, feature restrictions, or license expiration dates.
Upon termination, you must immediately cease all use of the Software and ensure that no copies or backups of the Software binaries remain in your possession or under your control. Sections pertaining to Intellectual Property Rights (1), Hardware Binding (2), Restrictions (4), Disclaimers (7), Limitations of Liability (8), and Indemnification (9) shall survive termination.

## 11. GOVERNING LAW AND SEVERABILITY
This EULA shall be governed by, and construed in accordance with, the laws of the jurisdiction in which the Licensor operates, irrespective of your location or any conflict of law provisions. If any provision of this EULA is deemed invalid, void, or for any reason unenforceable, that provision shall be reformed only to the extent necessary to make it enforceable, and it shall not affect the validity and enforceability of any remaining provisions.

---
By operating the Workstation and the Software bundled within, the Company/End-User explicitly acknowledges reading, comprehending, and agreeing to be bound unconditionally by the terms of this End User License Agreement.
---
