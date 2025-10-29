import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);
  private ollamaUrl = 'http://localhost:11434/api/generate';
  private trelloApiUrl = 'https://api.trello.com/1/cards';

  private trelloKey: string;
  private trelloToken: string;
  private trelloIdListConsultas: string;
  private trelloIdListIA: string;
  private trelloIdListHuman: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.trelloKey = this.configService.get<string>('TRELLO_KEY');
    this.trelloToken = this.configService.get<string>('TRELLO_TOKEN');
    this.trelloIdListConsultas = this.configService.get<string>(
      'TRELLO_ID_LIST_CONSULTAS',
    );
    this.trelloIdListIA = this.configService.get<string>('TRELLO_ID_LIST_IA');
    this.trelloIdListHuman = this.configService.get<string>(
      'TRELLO_ID_LIST_HUMAN',
    );

    this.validateTrelloConfig();
  }

  private validateTrelloConfig() {
    const requiredVars = [
      'TRELLO_KEY',
      'TRELLO_TOKEN',
      'TRELLO_ID_LIST_CONSULTAS',
      'TRELLO_ID_LIST_IA',
      'TRELLO_ID_LIST_HUMAN',
    ];

    for (const varName of requiredVars) {
      if (!this.configService.get<string>(varName)) {
        throw new Error(`${varName} no está configurado`);
      }
    }

    this.logger.log('✅ Configuración de Trello cargada correctamente');
    this.logger.log(`📋 Lista Consultas: ${this.trelloIdListConsultas}`);
    this.logger.log(`📋 Lista IA: ${this.trelloIdListIA}`);
    this.logger.log(`📋 Lista Humano: ${this.trelloIdListHuman}`);
  }

  async processNewTicket(userQuestion: string) {
    this.logger.log(`📩 Nueva pregunta recibida: ${userQuestion}`);

    try {
      // PASO 1: Crear ticket en lista de Consultas
      const trelloTicket = await this.createTrelloTicket(userQuestion);
      this.logger.log(`✅ Ticket creado en Trello: ${trelloTicket.shortUrl}`);

      // PASO 2: Obtener respuesta de IA y determinar si puede resolver
      const aiResponse = await this.callOllama(userQuestion);
      this.logger.log('🤖 Respuesta de IA generada');

      // PASO 3: Analizar si la IA puede resolver la pregunta
      const canIAResolve = this.canIAResolve(aiResponse);

      if (canIAResolve) {
        // La IA resolvió - mover a lista IA
        await this.moveTrelloTicket(trelloTicket.id, this.trelloIdListIA);
        await this.updateTrelloTicket(
          trelloTicket.id,
          aiResponse,
          'resuelto_por_ia',
        );

        this.logger.log('✅ Pregunta resuelta por IA');

        return {
          status: 'success',
          resuelto_por: 'ia',
          pregunta: userQuestion,
          respuesta_ia: aiResponse,
          ticket_trello: {
            id: trelloTicket.id,
            url: trelloTicket.shortUrl,
            lista: 'IA responses',
          },
        };
      } else {
        // La IA NO pudo resolver - mover a lista Humano
        await this.moveTrelloTicket(trelloTicket.id, this.trelloIdListHuman);
        await this.updateTrelloTicket(
          trelloTicket.id,
          aiResponse,
          'derivado_a_humano',
        );

        // 🔥 NUEVO: Consola para humano con toda la información
        this.notifyHumanAgent(userQuestion, aiResponse, trelloTicket);

        this.logger.log('🔄 Pregunta derivada a agente humano');

        return {
          status: 'success',
          resuelto_por: 'humano',
          pregunta: userQuestion,
          respuesta_ia: aiResponse,
          mensaje: 'Tu consulta ha sido derivada a un especialista',
          ticket_trello: {
            id: trelloTicket.id,
            url: trelloTicket.shortUrl,
            lista: 'Human responses',
          },
        };
      }
    } catch (error) {
      this.logger.error('❌ Error en el procesamiento:', error.message);

      return {
        error: 'No se pudo procesar la solicitud.',
        details: error.message,
      };
    }
  }

  private async createTrelloTicket(question: string) {
    const payload = {
      idList: this.trelloIdListConsultas,
      name: `Consulta: ${question.substring(0, 50)}${question.length > 50 ? '...' : ''}`,
      desc: `**Pregunta:** ${question}\n\n**Estado:** En proceso\n**Fecha:** ${new Date().toISOString()}`,
      due: null,
    };

    const queryParams = {
      key: this.trelloKey,
      token: this.trelloToken,
    };

    this.logger.log(`🔄 Creando ticket en lista Consultas...`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.trelloApiUrl, payload, {
          params: queryParams,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      );

      this.logger.log(`✅ Ticket creado exitosamente: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error('❌ Error creando ticket en Trello:', error.message);
      throw error;
    }
  }

  private async moveTrelloTicket(cardId: string, targetListId: string) {
    const payload = {
      idList: targetListId,
    };

    const queryParams = {
      key: this.trelloKey,
      token: this.trelloToken,
    };

    try {
      await firstValueFrom(
        this.httpService.put(`${this.trelloApiUrl}/${cardId}`, payload, {
          params: queryParams,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(`✅ Ticket ${cardId} movido a lista ${targetListId}`);
    } catch (error) {
      this.logger.error(`❌ Error moviendo ticket ${cardId}:`, error.message);
      throw error;
    }
  }

  private async updateTrelloTicket(
    cardId: string,
    aiResponse: string,
    status: string,
  ) {
    const statusLabels = {
      resuelto_por_ia: '✅ Resuelto por IA',
      derivado_a_humano: '👤 Derivado a humano',
      error: '❌ Error',
    };

    const payload = {
      desc: `**Respuesta IA:** ${aiResponse}\n\n**Estado:** ${statusLabels[status]}\n**Fecha Resolución:** ${new Date().toISOString()}`,
    };

    const queryParams = {
      key: this.trelloKey,
      token: this.trelloToken,
    };

    try {
      await firstValueFrom(
        this.httpService.put(`${this.trelloApiUrl}/${cardId}`, payload, {
          params: queryParams,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(`✅ Ticket ${cardId} actualizado: ${status}`);
    } catch (error) {
      this.logger.error(
        `❌ Error actualizando ticket ${cardId}:`,
        error.message,
      );
    }
  }

  private async callOllama(userQuestion: string) {
    // 🔥 NUEVO PROMPT con instrucción específica para ERR_FOR_HUMAN
    const prompt = `
Eres un asistente especializado de mesa de ayuda para una aplicación empresarial.

INSTRUCCIONES CRÍTICAS:
1. Responde DIRECTAMENTE la pregunta si tienes seguridad absoluta.
2. Si la pregunta es sobre funcionalidades básicas, configuración simple, o problemas comunes, RESPONDE DIRECTAMENTE.
3. SOLO si la pregunta requiere: 
   - Información sensible o confidencial
   - Configuración avanzada del sistema
   - Decisiones empresariales importantes
   - Contexto específico que no tienes
   - Acceso a datos privados de usuarios
   ENTONCES devuelve EXACTAMENTE: "ERR_FOR_HUMAN"

Pregunta del usuario: "${userQuestion}"

Si puedes responder con seguridad, da una respuesta clara y útil. Si no, devuelve EXACTAMENTE "ERR_FOR_HUMAN" sin explicaciones adicionales.
    `;

    // 🔥 NUEVO: Payload expandido con parámetros de Ollama
    const payload = {
      model: 'llama3',
      prompt: prompt,
      stream: false,
      // Parámetros adicionales para controlar el comportamiento
      options: {
        temperature: 0.3, // Controla creatividad (0 = más determinista, 1 = más creativo)
        top_p: 0.9, // Controla diversidad de respuestas
        top_k: 40, // Limita opciones de vocabulario
        num_predict: 512, // Longitud máxima de respuesta
        repeat_penalty: 1.1, // Penaliza repeticiones
        stop: ['ERR_FOR_HUMAN', 'Usuario:'], // Palabras que detienen la generación
      },
    };

    this.logger.log('🔧 Enviando payload a Ollama:');
    this.logger.log(`📤 Modelo: ${payload.model}`);
    this.logger.log(`📤 Temperature: ${payload.options.temperature}`);
    this.logger.log(`📤 Prompt length: ${prompt.length}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.ollamaUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

      // 🔥 NUEVO: Log completo de la respuesta cruda
      this.logger.log('📨 RESPUESTA CRUDA DE OLLAMA:');
      this.logger.log(`📨 Tipo de respuesta: ${typeof response.data}`);
      this.logger.log(
        `📨 Estructura completa: ${JSON.stringify(response.data, null, 2)}`,
      );

      // Verificar la estructura de la respuesta
      if (typeof response.data === 'string') {
        this.logger.log('🔍 La respuesta es un string directo');
        return response.data.trim();
      } else if (response.data && typeof response.data === 'object') {
        this.logger.log('🔍 La respuesta es un objeto JSON');
        // Ollama generalmente devuelve { response: string, ... }
        if (response.data.response) {
          return response.data.response.trim();
        } else {
          this.logger.warn(
            '⚠️ Objeto sin campo "response":',
            JSON.stringify(response.data),
          );
          return JSON.stringify(response.data);
        }
      } else {
        this.logger.warn(
          '⚠️ Tipo de respuesta inesperado:',
          typeof response.data,
        );
        return String(response.data).trim();
      }
    } catch (error) {
      this.logger.error('❌ Error llamando a Ollama:', error.message);
      if (error.response) {
        this.logger.error('📨 Error response data:', error.response.data);
        this.logger.error('📨 Error response status:', error.response.status);
      }
      return 'ERR_FOR_HUMAN';
    }
  }

  private canIAResolve(aiResponse: string): boolean {
    this.logger.log(`🔍 Analizando respuesta de IA...`);
    this.logger.log(`📝 Respuesta recibida: "${aiResponse}"`);

    // 🔥 NUEVO: Detección explícita de ERR_FOR_HUMAN
    if (aiResponse.trim() === 'ERR_FOR_HUMAN') {
      this.logger.log('❌ La IA devolvió explícitamente ERR_FOR_HUMAN');
      return false;
    }

    // También verificar si contiene la frase (por si hay espacios adicionales)
    if (aiResponse.includes('ERR_FOR_HUMAN')) {
      this.logger.log('❌ La IA contiene ERR_FOR_HUMAN en la respuesta');
      return false;
    }

    // Verificar si la respuesta es muy corta (posible error)
    if (aiResponse.trim().length < 10) {
      this.logger.log(
        `❌ Respuesta muy corta: ${aiResponse.length} caracteres`,
      );
      return false;
    }

    // Verificar si la respuesta parece un error
    if (aiResponse.toLowerCase().includes('error') && aiResponse.length < 50) {
      this.logger.log('❌ Respuesta parece ser un mensaje de error');
      return false;
    }

    // Si pasa todos los filtros, la IA puede resolver
    this.logger.log('✅ La IA puede resolver esta pregunta');
    return true;
  }

  // 🔥 NUEVO: Método para notificar al agente humano
  private notifyHumanAgent(
    userQuestion: string,
    aiResponse: string,
    trelloTicket: any,
  ) {
    this.logger.log('\n🎯 ===========================================');
    this.logger.log('🎯 CONSULTA DERIVADA A AGENTE HUMANO');
    this.logger.log('🎯 ===========================================');
    this.logger.log(`🎯 Ticket ID: ${trelloTicket.id}`);
    this.logger.log(`🎯 Ticket URL: ${trelloTicket.shortUrl}`);
    this.logger.log(`🎯 Pregunta del usuario: ${userQuestion}`);
    this.logger.log(
      `🎯 Respuesta de IA que provocó la derivación: ${aiResponse}`,
    );
    this.logger.log(`🎯 Fecha: ${new Date().toISOString()}`);
    this.logger.log('🎯 ===========================================\n');
    // Aquí en el futuro podrías:
    // - Enviar un email al equipo de soporte
    // - Enviar una notificación a Slack/Discord
    // - Agregar a una cola de procesamiento humano
  }
}
